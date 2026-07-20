import React from "react";

const variantClasses = {
  default: "bg-blue-600 text-white hover:bg-blue-700",
  outline: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
  ghost: "bg-transparent text-gray-700 hover:bg-gray-100",
  secondary: "bg-gray-200 text-gray-800 hover:bg-gray-300",
  destructive: "bg-red-600 text-white hover:bg-red-700",
};

const sizeClasses = {
  default: "px-3 py-2 text-sm",
  icon: "p-2",
  sm: "px-2 py-1 text-xs",
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
      className={`inline-flex items-center justify-center rounded font-medium transition-colors duration-150 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant] ?? variantClasses.default} ${sizeClasses[size] ?? sizeClasses.default} ${className}`}
    >
      {children}
    </button>
  );
}