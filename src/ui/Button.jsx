import React from "react";

const variantClasses = {
  default: "rie-v013-bg-blue-600 rie-v013-text-white hover:rie-v013-bg-blue-700",
  outline: "rie-v013-border rie-v013-border-gray-300 rie-v013-bg-white rie-v013-text-gray-700 hover:rie-v013-bg-gray-50",
  ghost: "rie-v013-bg-transparent rie-v013-text-gray-700 hover:rie-v013-bg-gray-100",
  secondary: "rie-v013-bg-gray-200 rie-v013-text-gray-800 hover:rie-v013-bg-gray-300",
  destructive: "rie-v013-bg-red-600 rie-v013-text-white hover:rie-v013-bg-red-700",
};

const sizeClasses = {
  default: "rie-v013-px-3 rie-v013-py-2 rie-v013-text-sm",
  icon: "rie-v013-p-2",
  sm: "rie-v013-px-2 rie-v013-py-1 rie-v013-text-xs",
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
      className={`rie-v013-inline-flex rie-v013-items-center rie-v013-justify-center rie-v013-rounded rie-v013-font-medium rie-v013-transition-colors rie-v013-duration-150 focus:rie-v013-outline-none disabled:rie-v013-opacity-50 disabled:rie-v013-cursor-not-allowed ${variantClasses[variant] ?? variantClasses.default} ${sizeClasses[size] ?? sizeClasses.default} ${className}`}
    >
      {children}
    </button>
  );
}