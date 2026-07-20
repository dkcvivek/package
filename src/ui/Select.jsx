import React from "react";

export function Select({ value, onValueChange, children }) {
  // Extract items from children to build native select
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 appearance-none pr-7"
      >
        {children}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-gray-500 text-xs">▼</div>
    </div>
  );
}

// These are pass-through — the Select above renders a native <select>
export function SelectTrigger({ children }) { return <>{children}</>; }
export function SelectValue({ placeholder }) { return null; }
export function SelectContent({ children }) { return <>{children}</>; }

export function SelectItem({ value, children }) {
  // Extract text from children (could be a div with icon + text)
  return <option value={value}>{typeof children === "string" ? children : value}</option>;
}