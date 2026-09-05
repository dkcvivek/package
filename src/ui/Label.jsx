"use client";
import React from "react";

export function Label({ children, htmlFor, className = "" }) {
  return (
    <label htmlFor={htmlFor} className={`rie-text-sm rie-font-medium rie-text-gray-700 ${className}`}>
      {children}
    </label>
  );
}