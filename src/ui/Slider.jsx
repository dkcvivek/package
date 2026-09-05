"use client";
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
      className={`rie-w-full rie-h-2 rie-bg-gray-200 rie-rounded-lg rie-appearance-none rie-cursor-pointer rie-accent-blue-600 ${className}`}
    />
  );
}