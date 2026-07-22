import React from "react";

export function Slider({ min, max, step, value, onValueChange, className = "", id }) {
  return (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value[0]}
      onChange={(e) => onValueChange([Number(e.target.value)])}
      className={`rie-v013-w-full rie-v013-h-2 rie-v013-bg-gray-200 rie-v013-rounded-lg rie-v013-appearance-none rie-v013-cursor-pointer rie-v013-accent-blue-600 ${className}`}
    />
  );
}