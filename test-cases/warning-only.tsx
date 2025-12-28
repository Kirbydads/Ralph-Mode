// Test file with only warnings (non-critical issues)
import React from 'react';

// Warning: console.log (medium severity, not blocking)
console.log("Debug message");

// Warning: debugger statement (medium severity, not blocking)
debugger;

export function WarningComponent() {
  return <div>Test</div>;
}
