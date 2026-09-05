"use client";
import React from "react";

const variantClasses = {
  default: "rie-bg-blue-600 rie-text-white hover:rie-bg-blue-700",
  outline: "rie-border rie-border-gray-300 rie-bg-white rie-text-gray-700 rie-shadow-sm hover:rie-bg-gray-50",
  ghost: "rie-bg-transparent rie-text-gray-700 hover:rie-bg-gray-100",
  secondary: "rie-bg-gray-200 rie-text-gray-800 hover:rie-bg-gray-300",
  destructive: "rie-bg-red-600 rie-text-white hover:rie-bg-red-700",
  // Sidebar tool tiles: read as buttons at rest, unmistakable when active.
  tool: "rie-bg-white rie-text-gray-700 rie-border rie-border-gray-200 rie-shadow-sm hover:rie-bg-gray-50 hover:rie-border-gray-300 focus-visible:rie-ring-2 focus-visible:rie-ring-blue-500 focus-visible:rie-ring-offset-1",
  toolActive: "rie-bg-blue-600 rie-text-white rie-border rie-border-blue-600 rie-shadow-sm hover:rie-bg-blue-700 focus-visible:rie-ring-2 focus-visible:rie-ring-blue-500 focus-visible:rie-ring-offset-1",
};

const sizeClasses = {
  default: "rie-px-3 rie-py-2 rie-text-sm",
  icon: "rie-p-2",
  sm: "rie-px-2 rie-py-1 rie-text-xs",
};

export function Button({
  children,
  onClick,
  variant = "default",
  size = "default",
  disabled = false,
  type = "button",
  className = "",
  title,
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rie-inline-flex rie-items-center rie-justify-center rie-rounded rie-font-medium rie-transition-colors rie-duration-150 focus:rie-outline-none disabled:rie-opacity-50 disabled:rie-cursor-not-allowed ${variantClasses[variant] ?? variantClasses.default} ${sizeClasses[size] ?? sizeClasses.default} ${className}`}
    >
      {children}
    </button>
  );
}