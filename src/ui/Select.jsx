import React from "react";

export function Select({ value, onValueChange, children }) {
  // Extract items from children to build native select
  return (
    <div className="rie-v0.1.1-relative">
      <select
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="rie-v0.1.1-w-full rie-v0.1.1-border rie-v0.1.1-border-gray-300 rie-v0.1.1-rounded rie-v0.1.1-px-2 rie-v0.1.1-py-1.5 rie-v0.1.1-text-sm rie-v0.1.1-bg-white focus:rie-v0.1.1-outline-none focus:rie-v0.1.1-ring-1 focus:rie-v0.1.1-ring-blue-500 rie-v0.1.1-appearance-none rie-v0.1.1-pr-7"
      >
        {children}
      </select>
      <div className="rie-v0.1.1-pointer-events-none rie-v0.1.1-absolute rie-v0.1.1-inset-y-0 rie-v0.1.1-right-2 rie-v0.1.1-flex rie-v0.1.1-items-center rie-v0.1.1-text-gray-500 rie-v0.1.1-text-xs">▼</div>
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