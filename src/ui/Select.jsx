import React from "react";

export function Select({ value, onValueChange, children }) {
  // Extract items from children to build native select
  return (
    <div className="rie-v013-relative">
      <select
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="rie-v013-w-full rie-v013-border rie-v013-border-gray-300 rie-v013-rounded rie-v013-px-2 rie-v013-py-1.5 rie-v013-text-sm rie-v013-bg-white focus:rie-v013-outline-none focus:rie-v013-ring-1 focus:rie-v013-ring-blue-500 rie-v013-appearance-none rie-v013-pr-7"
      >
        {children}
      </select>
      <div className="rie-v013-pointer-events-none rie-v013-absolute rie-v013-inset-y-0 rie-v013-right-2 rie-v013-flex rie-v013-items-center rie-v013-text-gray-500 rie-v013-text-xs">▼</div>
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