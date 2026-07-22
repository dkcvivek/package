import React from "react";

const variantClasses = {
  default: "rie-v0.1.1-bg-blue-600 rie-v0.1.1-text-white hover:rie-v0.1.1-bg-blue-700",
  outline: "rie-v0.1.1-border rie-v0.1.1-border-gray-300 rie-v0.1.1-bg-white rie-v0.1.1-text-gray-700 hover:rie-v0.1.1-bg-gray-50",
  ghost: "rie-v0.1.1-bg-transparent rie-v0.1.1-text-gray-700 hover:rie-v0.1.1-bg-gray-100",
  secondary: "rie-v0.1.1-bg-gray-200 rie-v0.1.1-text-gray-800 hover:rie-v0.1.1-bg-gray-300",
  destructive: "rie-v0.1.1-bg-red-600 rie-v0.1.1-text-white hover:rie-v0.1.1-bg-red-700",
};

const sizeClasses = {
  default: "rie-v0.1.1-px-3 rie-v0.1.1-py-2 rie-v0.1.1-text-sm",
  icon: "rie-v0.1.1-p-2",
  sm: "rie-v0.1.1-px-2 rie-v0.1.1-py-1 rie-v0.1.1-text-xs",
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
      className={`rie-v0.1.1-inline-flex rie-v0.1.1-items-center rie-v0.1.1-justify-center rie-v0.1.1-rounded rie-v0.1.1-font-medium rie-v0.1.1-transition-colors rie-v0.1.1-duration-150 focus:rie-v0.1.1-outline-none disabled:rie-v0.1.1-opacity-50 disabled:rie-v0.1.1-cursor-not-allowed ${variantClasses[variant] ?? variantClasses.default} ${sizeClasses[size] ?? sizeClasses.default} ${className}`}
    >
      {children}
    </button>
  );
}