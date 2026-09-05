#!/usr/bin/env node
/**
 * prefix-classnames.mjs — v6
 *
 * WHAT'S NEW vs the version that produced "rie-!flex" (the bug):
 *
 *  (1) "!" important modifier — FIXED PROPERLY.
 *      "!flex" -> "!rie-flex" (the "!" stays in front, prefix goes after it).
 *      The old script glued the prefix in front of the "!" instead
 *      ("rie-!flex"), which is not a valid Tailwind class.
 *
 *  (2) Colon-splitting is now "bracket-aware".
 *      A class like `bg-[url('http://x.com')]` used to get wrongly split
 *      on the colon inside the URL, corrupting the class. Colons are only
 *      treated as Tailwind variant separators (hover:, md:, etc.) when
 *      they're OUTSIDE square brackets.
 *
 *  (3) Negative values ("-mt-4") — unchanged behavior, still correct,
 *      now also correctly combined with "!" when both appear ("!-mt-4").
 *
 *  (4) Variables holding classNames are now traced through REAL scope
 *      (using Babel's scope/binding info), not just a name guess.
 *      Example: `const styles = "flex gap-2"; ... className={styles}`
 *      is now found even though "styles" doesn't contain the word "class".
 *      The old name-based heuristic (variable name contains "class") is
 *      KEPT as a backup, in case a variable is used somewhere the script
 *      can't trace (e.g. exported and used in another file).
 *
 *  (5) Objects holding classNames (both key-style `{ "flex": cond }` and
 *      value-style `{ default: "bg-blue-600 ..." }`) are handled, and now
 *      an object's value that is ITSELF a variable is also traced.
 *
 *  (6) className-like PROPS ON YOUR OWN COMPONENTS are now caught too —
 *      not just the literal word "className". Any JSX attribute whose
 *      name contains "class" (case-insensitive) — e.g. `wrapperClassName`,
 *      `activeClass`, `iconClassName` — is treated the same way.
 *
 * Things still NOT auto-fixed (printed as warnings — check these by hand):
 *   - string concatenation ("a" + "b")
 *   - a computed object key (the key itself is a variable)
 *   - a class built from a variable that's only defined in another file
 *
 * USAGE:
 *   node scripts/prefix-classnames.mjs --dir ./src --prefix rie- --dry
 *   node scripts/prefix-classnames.mjs --dir ./src --prefix rie- --write
 *
 * Always run --dry first. Always start from a clean git state (no
 * half-applied prefix already in your files) before running --write.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "glob";
import path from "node:path";
import * as babelParserLib from "@babel/parser";
import babelTraverseModule from "@babel/traverse";

const traverse = babelTraverseModule.default || babelTraverseModule;

// ---- CLI args ----
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : fallback;
}
const DIR = getArg("--dir", "./src");
const PREFIX = getArg("--prefix", "rie-");
const WRITE = args.includes("--write");
const ATTR_NAME = getArg("--attr", "className");

let warnings = [];
let reviewItems = []; // complex changes: { filePath, before, after, note? }
let simpleRenameCount = 0; // plain static strings, auto-applied, not shown

// ---------------------------------------------------------------------
// splitVariants: like "hover:md:!bg-red-500".split(":"), but IGNORES
// colons that are inside square brackets, e.g. "bg-[url('http://x.com')]".
// Returns { variants: [...], base: "..." } where base is the last segment.
// ---------------------------------------------------------------------
function splitVariants(token) {
  const segments = [];
  let depth = 0;
  let current = "";
  for (const ch of token) {
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === ":" && depth === 0) {
      segments.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  segments.push(current);
  const base = segments.pop();
  return { variants: segments, base };
}

// ---- core: prefix a single space-separated class-list string ----
function prefixToken(token, prefix) {
  if (!token) return token;
  const { variants, base } = splitVariants(token);
  if (!base) return token;

  // "!" = Tailwind's important modifier. It must stay in front of the
  // class, and must NOT itself be prefixed.
  const important = base.startsWith("!");
  const withoutImportant = important ? base.slice(1) : base;

  // "-" = negative value (e.g. "-mt-4"). Same "peel off, prefix, put back"
  // idea as "!" above.
  const unsigned = withoutImportant.startsWith("-")
    ? withoutImportant.slice(1)
    : withoutImportant;
  if (unsigned.startsWith(prefix)) return token; // already prefixed, idempotent

  const prefixedCore = withoutImportant.startsWith("-")
    ? `-${prefix}${withoutImportant.slice(1)}`
    : `${prefix}${withoutImportant}`;

  const prefixedBase = important ? `!${prefixedCore}` : prefixedCore;

  return [...variants, prefixedBase].join(":");
}

function prefixClassString(str, prefix) {
  const leading = str.match(/^\s*/)[0];
  const trailing = str.match(/\s*$/)[0];
  const core = str.slice(leading.length, str.length - trailing.length);
  if (!core) return str;
  const rewritten = core
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => prefixToken(tok, prefix))
    .join(" ");
  return leading + rewritten + trailing;
}

// A node is "simple" if it's a static string with nothing dynamic in it.
function classify(node) {
  if (node.type === "StringLiteral") return "simple";
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return "simple";
  return "complex";
}

// ---- splice a set of {start, end, newText} edits into a text range ----
function applyEditsToText(text, edits, baseOffset) {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let result = "";
  let cursor = 0;
  for (const e of sorted) {
    const localStart = e.start - baseOffset;
    const localEnd = e.end - baseOffset;
    if (localStart < cursor || localEnd > text.length || localStart < 0) continue;
    result += text.slice(cursor, localStart);
    result += e.newText;
    cursor = localEnd;
  }
  result += text.slice(cursor);
  return result;
}

// ---------------------------------------------------------------------
// resolveAndCollect: given an Identifier node (e.g. the "styles" in
// `className={styles}`), look up WHERE that variable was actually
// declared (using Babel's scope info — this is real data-flow tracing,
// not a name guess), and if it's a string/template/object holding
// classes, prefix it right there at its declaration.
// ---------------------------------------------------------------------
function resolveAndCollect(identifierNode, edits, filePath, ctx) {
  const { scope, original, processedInits } = ctx;
  if (!scope) return;
  const binding = scope.getBinding(identifierNode.name);
  if (!binding || !binding.path.isVariableDeclarator()) return;

  const declaratorNode = binding.path.node;
  if (processedInits.has(declaratorNode)) return; // already handled, skip duplicate
  processedInits.add(declaratorNode);

  const init = declaratorNode.init;
  if (!init) return;

  if (init.type === "StringLiteral" || init.type === "TemplateLiteral") {
    const localEdits = [];
    collectEdits(init, localEdits, filePath, ctx);
    if (localEdits.length === 0) return;
    edits.push(...localEdits);
    const beforeText = original.slice(declaratorNode.start, declaratorNode.end);
    const afterText = applyEditsToText(beforeText, localEdits, declaratorNode.start);
    reviewItems.push({
      filePath,
      before: beforeText,
      after: afterText,
      note: `traced via scope: variable "${identifierNode.name}" (found from where it's used)`,
    });
    return;
  }

  if (init.type === "ObjectExpression") {
    const localEdits = [];
    collectEditsForClassValueMap(init, localEdits, filePath, ctx);
    if (localEdits.length === 0) return;
    edits.push(...localEdits);
    const beforeText = original.slice(declaratorNode.start, declaratorNode.end);
    const afterText = applyEditsToText(beforeText, localEdits, declaratorNode.start);
    reviewItems.push({
      filePath,
      before: beforeText,
      after: afterText,
      note: `traced via scope: variable "${identifierNode.name}" (object value-map, found from where it's used)`,
    });
  }
}

// ---- walk an expression, pushing {start, end, newText} edits for every ----
// ---- real class string found (never touches actual JS syntax) ----
function collectEdits(node, edits, filePath, ctx) {
  if (!node) return;

  switch (node.type) {
    case "StringLiteral": {
      const oldRaw = node.extra?.raw ?? JSON.stringify(node.value);
      const quote = oldRaw[0];
      const inner = oldRaw.slice(1, -1);
      const newInner = prefixClassString(inner, PREFIX);
      if (newInner !== inner) {
        edits.push({ start: node.start, end: node.end, newText: `${quote}${newInner}${quote}` });
      }
      return;
    }

    case "TemplateLiteral": {
      for (const quasi of node.quasis) {
        const rawOld = quasi.value.raw;
        const rawNew = prefixClassString(rawOld, PREFIX);
        if (rawNew !== rawOld) {
          edits.push({ start: quasi.start, end: quasi.end, newText: rawNew });
        }
      }
      for (const expr of node.expressions) collectEdits(expr, edits, filePath, ctx);
      return;
    }

    case "ConditionalExpression": {
      collectEdits(node.consequent, edits, filePath, ctx);
      collectEdits(node.alternate, edits, filePath, ctx);
      return;
    }

    case "LogicalExpression": {
      collectEdits(node.left, edits, filePath, ctx);
      collectEdits(node.right, edits, filePath, ctx);
      return;
    }

    case "ParenthesizedExpression": {
      collectEdits(node.expression, edits, filePath, ctx);
      return;
    }

    case "CallExpression": {
      for (const arg of node.arguments) collectEdits(arg, edits, filePath, ctx);
      return;
    }

    case "ArrayExpression": {
      for (const el of node.elements) if (el) collectEdits(el, edits, filePath, ctx);
      return;
    }

    case "ObjectExpression": {
      // clsx-style: { "flex": someCondition, "hidden": !someCondition }
      // Here the KEYS are classes, the VALUES are booleans — never classes.
      for (const prop of node.properties) {
        if (prop.type !== "ObjectProperty" && prop.type !== "Property") continue;
        if (prop.computed) {
          warnings.push(
            `${filePath}: skipped a computed object key in a className object (can't safely prefix a variable key) — review manually.`
          );
          continue;
        }
        if (prop.key.type === "StringLiteral") {
          const oldRaw = prop.key.extra?.raw ?? JSON.stringify(prop.key.value);
          const quote = oldRaw[0];
          const inner = oldRaw.slice(1, -1);
          const newInner = prefixClassString(inner, PREFIX);
          if (newInner !== inner) {
            edits.push({
              start: prop.key.start,
              end: prop.key.end,
              newText: `${quote}${newInner}${quote}`,
            });
          }
        } else if (prop.key.type === "Identifier") {
          warnings.push(
            `${filePath}: found an unquoted object key "${prop.key.name}" in a className object — if this is meant to be a Tailwind class, quote it (e.g. "${prop.key.name}": cond). Left untouched.`
          );
        }
        // prop.value is the boolean condition here, never a class — skip it
      }
      return;
    }

    case "Identifier": {
      // e.g. className={styles} — go find where "styles" was declared.
      resolveAndCollect(node, edits, filePath, ctx);
      return;
    }

    case "MemberExpression":
    case "NumericLiteral": {
      return; // property access, numbers — nothing to prefix here
    }

    default: {
      if (node.type === "BinaryExpression" && node.operator === "+") {
        warnings.push(
          `${filePath}: found string concatenation ("a" + "b") in a className — not handled automatically, review manually.`
        );
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------
// collectEditsForClassValueMap: walk an ObjectExpression whose VALUES
// are className strings, e.g.
//   const variantClasses = { default: "bg-blue-600 ...", outline: "..." }
// Unlike collectEdits' ObjectExpression case (which prefixes STRING KEYS
// for the clsx-style `{ "flex": cond }` pattern), this prefixes the VALUES.
// ---------------------------------------------------------------------
function collectEditsForClassValueMap(node, edits, filePath, ctx) {
  if (!node || node.type !== "ObjectExpression") return;
  for (const prop of node.properties) {
    if (prop.type !== "ObjectProperty" && prop.type !== "Property") continue;
    if (prop.computed) {
      warnings.push(
        `${filePath}: skipped a computed key in a className value-map — review manually.`
      );
      continue;
    }

    if (prop.value.type === "StringLiteral") {
      const oldRaw = prop.value.extra?.raw ?? JSON.stringify(prop.value.value);
      const quote = oldRaw[0];
      const inner = oldRaw.slice(1, -1);
      const newInner = prefixClassString(inner, PREFIX);
      if (newInner !== inner) {
        edits.push({
          start: prop.value.start,
          end: prop.value.end,
          newText: `${quote}${newInner}${quote}`,
        });
      }
    } else if (prop.value.type === "TemplateLiteral" && prop.value.expressions.length === 0) {
      for (const quasi of prop.value.quasis) {
        const rawOld = quasi.value.raw;
        const rawNew = prefixClassString(rawOld, PREFIX);
        if (rawNew !== rawOld) {
          edits.push({ start: quasi.start, end: quasi.end, newText: rawNew });
        }
      }
    } else if (prop.value.type === "Identifier" && ctx) {
      // value is itself a variable, e.g. { default: baseClasses } — trace it
      resolveAndCollect(prop.value, edits, filePath, ctx);
    } else {
      warnings.push(
        `${filePath}: className value-map entry "${
          prop.key.name ?? prop.key.value
        }" has a non-static value — review manually.`
      );
    }
  }
}

// ---- process one file ----
function processFile(filePath) {
  const original = readFileSync(filePath, "utf8");

  let ast;
  try {
    ast = babelParserLib.parse(original, {
      sourceType: "module",
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      plugins: [
        "jsx",
        "typescript",
        "classProperties",
        "classPrivateProperties",
        "classPrivateMethods",
        "objectRestSpread",
        "optionalChaining",
        "nullishCoalescingOperator",
        "dynamicImport",
        "topLevelAwait",
      ],
    });
  } catch (err) {
    warnings.push(`${filePath}: FAILED TO PARSE, skipped — ${err.message}`);
    return { changed: false };
  }

  const fileEdits = [];
  const processedInits = new Set(); // dedupes variables handled twice (scope trace + name heuristic)

  traverse(ast, {
    JSXAttribute(path) {
      const attrNode = path.node;
      const isClassLikeAttr =
        attrNode.name.name === ATTR_NAME || /class/i.test(attrNode.name.name);
      if (!isClassLikeAttr) return;

      const value = attrNode.value;
      if (!value) return;

      const target =
        value.type === "StringLiteral"
          ? value
          : value.type === "JSXExpressionContainer"
            ? value.expression
            : null;
      if (!target) return;

      const ctx = { scope: path.scope, original, processedInits };
      const localEdits = [];
      collectEdits(target, localEdits, filePath, ctx);
      if (localEdits.length === 0) return;

      fileEdits.push(...localEdits);

      const kind = classify(target);
      if (kind === "simple") {
        simpleRenameCount++;
      } else {
        const beforeText = original.slice(attrNode.start, attrNode.end);
        const afterText = applyEditsToText(beforeText, localEdits, attrNode.start);
        reviewItems.push({ filePath, before: beforeText, after: afterText });
      }
    },

    // Backup net for variables named with "class" in them (e.g. "barClass",
    // "variantClasses") that the scope-tracing above might not have reached
    // yet (order of traversal, or used somewhere the scope trace can't see).
    VariableDeclarator(path) {
      const id = path.node.id;
      const init = path.node.init;
      if (!init || id.type !== "Identifier") return;
      if (!/class/i.test(id.name)) return;
      if (processedInits.has(path.node)) return; // already handled via scope trace
      processedInits.add(path.node);

      const ctx = { scope: path.scope, original, processedInits };

      if (init.type === "StringLiteral" || init.type === "TemplateLiteral") {
        const localEdits = [];
        collectEdits(init, localEdits, filePath, ctx);
        if (localEdits.length === 0) return;

        fileEdits.push(...localEdits);

        const beforeText = original.slice(path.node.start, path.node.end);
        const afterText = applyEditsToText(beforeText, localEdits, path.node.start);
        reviewItems.push({
          filePath,
          before: beforeText,
          after: afterText,
          note: `variable-name heuristic match: "${id.name}" (not a direct className usage)`,
        });
        return;
      }

      if (init.type === "ObjectExpression") {
        const localEdits = [];
        collectEditsForClassValueMap(init, localEdits, filePath, ctx);
        if (localEdits.length === 0) return;

        fileEdits.push(...localEdits);

        const beforeText = original.slice(path.node.start, path.node.end);
        const afterText = applyEditsToText(beforeText, localEdits, path.node.start);
        reviewItems.push({
          filePath,
          before: beforeText,
          after: afterText,
          note: `variable-name heuristic match: "${id.name}" (object value-map, not a direct className usage)`,
        });
      }
    },
  });

  if (fileEdits.length === 0) return { changed: false };

  const updated = applyEditsToText(original, fileEdits, 0);
  return { changed: true, updated };
}

// ---- run across all files ----
const files = globSync(`${DIR}/**/*.{js,jsx,ts,tsx}`, { nodir: true });

if (files.length === 0) {
  console.log(`No files found under ${DIR}. Check --dir.`);
  process.exit(1);
}

let totalChanged = 0;

for (const file of files) {
  const result = processFile(file);
  if (!result.changed) continue;
  totalChanged++;

  if (WRITE) {
    writeFileSync(file, result.updated, "utf8");
    console.log(`updated: ${path.relative(process.cwd(), file)}`);
  }
}

console.log(
  `\n${simpleRenameCount} plain static className(s) ${WRITE ? "were" : "would be"} renamed automatically (e.g. flex -> ${PREFIX}flex) — not shown, they're mechanical.`
);

if (reviewItems.length > 0) {
  console.log(
    `\n${reviewItems.length} item(s) involve dynamic classNames (ternaries, template literals, clsx, variables, value-maps) — please review:\n`
  );
  let lastFile = null;
  for (const item of reviewItems) {
    if (item.filePath !== lastFile) {
      console.log(`\n=== ${path.relative(process.cwd(), item.filePath)} ===`);
      lastFile = item.filePath;
    }
    if (item.note) console.log(`  (${item.note})`);
    console.log(`  - ${item.before}`);
    console.log(`  + ${item.after}`);
  }
} else {
  console.log(`\nNo dynamic/complex classNames found — everything was a mechanical rename.`);
}

console.log(
  `\n${WRITE ? "Updated" : "Would update"} ${totalChanged} file(s) out of ${files.length} scanned.`
);
if (!WRITE) {
  console.log("Dry run only — re-run with --write to apply changes.");
}

if (warnings.length > 0) {
  console.log(`\n${warnings.length} item(s) need manual attention (skipped, not auto-fixed):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
