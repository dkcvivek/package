import React from "react";

export function Label({ children, htmlFor, className = "" }) {
  return (
    <label htmlFor={htmlFor} className={`rie-v013-text-sm rie-v013-font-medium rie-v013-text-gray-700 ${className}`}>
      {children}
    </label>
  );
}