import React from "react";

export function Label({ children, htmlFor, className = "" }) {
  return (
    <label htmlFor={htmlFor} className={`rie-v0.1.1-text-sm rie-v0.1.1-font-medium rie-v0.1.1-text-gray-700 ${className}`}>
      {children}
    </label>
  );
}