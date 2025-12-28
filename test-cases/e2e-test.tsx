// End-to-end test file with multiple issues
import React from 'react';

// Issue 1: Hardcoded localhost URL
const apiUrl = process.env.API_URL;

// Issue 2: API key exposed
const key = "pk_test_12345";

// Issue 3: Console.log left in (removed)

// Issue 4: Debugger statement
debugger;

// TODO: Fix this later
export function TestComponent() {
  return <div>Test</div>;
}
