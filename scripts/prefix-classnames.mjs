#!/usr/bin/env node
/**
 * prefix-classnames.mjs
 *
 * v4 adds one thing on top of v3: VariableDeclarator now also handles
 * ObjectExpression inits (e.g. `const variantClasses = { default: "...", ... }`)
 * by prefixing every string-valued property, not just plain string/template
 * variables. Everything else (the span-splice approach, simple vs complex
 * classification, review workflow) is unchanged from v3.
 *
 * USAGE:
 *   node scripts/prefix-classnames.mjs --dir ./src --prefix rie-v0.1.1- --dry
 *   node scripts/prefix-classnames.mjs --dir ./src --prefix rie-v0.1.1- --write
 *
 * Always run --dry first.
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

// ---- core: prefix a single space-separated class-list string ----
function prefixToken(token, prefix) {
  if (!token) return token;
  const parts = token.split(":");
  const base = parts.pop();
  const variants = parts;
  if (!base) return token;

  const unsigned = base.startsWith("-") ? base.slice(1) : base;
  if (unsigned.startsWith(prefix)) return token; // already prefixed, idempotent

  const prefixedBase = base.startsWith("-")
    ? `-${prefix}${base.slice(1)}`
    : `${prefix}${base}`;

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

// ---- walk an expression, pushing {start, end, newText} edits for every ----
// ---- real class string found (never touches actual JS syntax) ----
function collectEdits(node, edits, filePath) {
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
      for (const expr of node.expressions) collectEdits(expr, edits, filePath);
      return;
    }

    case "ConditionalExpression": {
      collectEdits(node.consequent, edits, filePath);
      collectEdits(node.alternate, edits, filePath);
      return;
    }

    case "LogicalExpression": {
      collectEdits(node.left, edits, filePath);
      collectEdits(node.right, edits, filePath);
      return;
    }

    case "ParenthesizedExpression": {
      collectEdits(node.expression, edits, filePath);
      return;
    }

    case "CallExpression": {
      for (const arg of node.arguments) collectEdits(arg, edits, filePath);
      return;
    }

    case "ArrayExpression": {
      for (const el of node.elements) if (el) collectEdits(el, edits, filePath);
      return;
    }

    case "ObjectExpression": {
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
        // prop.value is the boolean condition, never a class — skip it
      }
      return;
    }

    case "MemberExpression":
    case "Identifier":
    case "NumericLiteral": {
      return; // variables, member access, numbers — nothing to prefix here
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

// ---- NEW in v4: walk an ObjectExpression whose VALUES are className strings ----
// (e.g. `const variantClasses = { default: "bg-blue-600 ...", ... }`)
// Unlike collectEdits' ObjectExpression case (which prefixes STRING KEYS for
// the clsx-style `{ "flex": cond }` pattern), this prefixes STRING VALUES.
function collectEditsForClassValueMap(node, edits, filePath) {
  if (!node || node.type !== "ObjectExpression") return;
  for (const prop of node.properties) {
    if (prop.type !== "ObjectProperty" && prop.type !== "Property") continue;
    if (prop.computed) {
      warnings.push(
        `${filePath}: skipped a computed key in a className value-map — review manually.`
      );
      continue;
    }
    // value must be a plain string or static template literal to be safe
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
    }
    // anything dynamic (ternary, template with expressions, etc.) inside a
    // value-map entry is left alone here and flagged for manual review
    else if (prop.value.type !== "StringLiteral") {
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

  traverse(ast, {
    JSXAttribute(path) {
      const attrNode = path.node;
      if (attrNode.name.name !== ATTR_NAME) return;

      const value = attrNode.value;
      if (!value) return;

      const target =
        value.type === "StringLiteral"
          ? value
          : value.type === "JSXExpressionContainer"
            ? value.expression
            : null;
      if (!target) return;

      const localEdits = [];
      collectEdits(target, localEdits, filePath);
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

    // `const barClass = "flex ...";` used later as `className={barClass}`,
    // AND (new in v4) `const variantClasses = { default: "bg-blue-600 ...",
    // outline: "...", ... }` maps whose values get spread into a className.
    // Both are caught by a naming heuristic (name contains "class",
    // case-insensitive) since we can't safely trace real data-flow — so
    // both always go to the review list, even for plain static strings.
    VariableDeclarator(path) {
      const id = path.node.id;
      const init = path.node.init;
      if (!init || id.type !== "Identifier") return;
      if (!/class/i.test(id.name)) return;

      if (init.type === "StringLiteral" || init.type === "TemplateLiteral") {
        const localEdits = [];
        collectEdits(init, localEdits, filePath);
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
        collectEditsForClassValueMap(init, localEdits, filePath);
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
