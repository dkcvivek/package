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
      className={`rie-v0.1.1-w-full rie-v0.1.1-h-2 rie-v0.1.1-bg-gray-200 rie-v0.1.1-rounded-lg rie-v0.1.1-appearance-none rie-v0.1.1-cursor-pointer rie-v0.1.1-accent-blue-600 ${className}`}
    />
  );
}