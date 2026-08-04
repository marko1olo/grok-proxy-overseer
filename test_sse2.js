const s = JSON.stringify({choices:[{delta:{tool_calls:[{function:{arguments:JSON.stringify({result: 'test'})}}]}}]});
let line = s;
if (line.includes('\\"result\\"')) {
    line = line.replace(/\\"result\\"/g, '\\"command\\"');
}
console.log(line);
