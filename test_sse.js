const s = JSON.stringify({choices:[{delta:{tool_calls:[{function:{arguments:JSON.stringify({result: 'test'})}}]}}]});
console.log("String:", s);
console.log("Includes '\"result\"':", s.includes('"result"'));
console.log("Includes '\\\\\"result\\\\\"':", s.includes('\\"result\\"'));
