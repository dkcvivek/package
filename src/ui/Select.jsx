"use client";
import React from "react";

export function Select({ value, onValueChange, children }) {
  // Extract items from children to build native select
  return (
    <div className="rie-relative">
      <select
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="rie-w-full rie-border rie-border-gray-300 rie-rounded rie-px-2 rie-py-1.5 rie-text-sm rie-bg-white focus:rie-outline-none focus:rie-ring-1 focus:rie-ring-blue-500 rie-appearance-none rie-pr-7"
      >
        {children}
      </select>
      <div className="rie-pointer-events-none rie-absolute rie-inset-y-0 rie-right-2 rie-flex rie-items-center rie-text-gray-500 rie-text-xs">▼</div>
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