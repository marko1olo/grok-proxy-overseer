const { Transform } = require('stream');

const state = { isCompletionStream: false, completionArgReplaced: false };
const processLine = (line) => {
    if (!line.startsWith('data: ') || line.startsWith('data: [DONE]')) return line;
    
    let modified = false;
    if (!line.includes('attempt_completion') && !state.isCompletionStream) return line;

    try {
        const parsed = JSON.parse(line.slice(6));
        if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.tool_calls) {
            for (const tc of parsed.choices[0].delta.tool_calls) {
                if (tc.function && tc.function.name === 'attempt_completion') {
                    tc.function.name = 'execute_command';
                    state.isCompletionStream = true;
                    modified = true;
                }
                if (state.isCompletionStream && tc.function && tc.function.arguments && typeof tc.function.arguments === 'string') {
                    if (!state.completionArgReplaced && tc.function.arguments.includes('"result"')) {
                        tc.function.arguments = tc.function.arguments.replace(/"result"/g, '"command"');
                        state.completionArgReplaced = true;
                        modified = true;
                    }
                }
            }
        }
        if (modified) return 'data: ' + JSON.stringify(parsed);
    } catch (e) {
        if (line.includes('"name":"attempt_completion"') || line.includes('"attempt_completion"')) {
            state.isCompletionStream = true;
            line = line.replace(/"name"\s*:\s*"attempt_completion"/g, '"name":"execute_command"').replace(/"attempt_completion"/g, '"execute_command"');
        }
        if (state.isCompletionStream && !state.completionArgReplaced) {
            if (line.includes('\\"result\\"')) {
                line = line.replace(/\\"result\\"/g, '\\"command\\"');
                state.completionArgReplaced = true;
            } else if (line.includes('"result"')) {
                line = line.replace(/"result"/g, '"command"');
                state.completionArgReplaced = true;
            }
        }
    }
    return line;
};

let lineBuffer = '';
const interceptor = new Transform({
    transform(chunk, encoding, callback) {
        lineBuffer += chunk.toString('utf8');
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';

        let out = '';
        for (let line of lines) {
            out += processLine(line) + '\n';
        }
        callback(null, Buffer.from(out, 'utf8'));
    },
    flush(callback) {
        if (lineBuffer) {
            this.push(Buffer.from(processLine(lineBuffer), 'utf8'));
        }
        callback();
    }
});

let output = '';
interceptor.on('data', chunk => output += chunk.toString());
interceptor.on('end', () => {
    console.log("FINAL OUTPUT:");
    console.log(output);
    if (output.includes('attempt_completion')) {
        console.error("FAIL: attempt_completion not replaced!");
        process.exit(1);
    }
    if (output.includes('\"result\"')) {
        console.error("FAIL: result argument not replaced!");
        process.exit(1);
    }
    if (output.includes('execute_command') && output.includes('\"command\"')) {
        console.log("PASS: Stream successfully intercepted and rewritten.");
    } else {
        console.error("FAIL: Missing execute_command or command");
        process.exit(1);
    }
});

// Simulate a stream broken into 1-byte chunks to test line buffering!
const payload = `data: {"id":"chatcmpl-123","choices":[{"delta":{"tool_calls":[{"function":{"name":"attempt_completion"}}]}}]}
data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{\\"result\\":\\"test data\\"}"}}]}}]}
data: [DONE]
`;

console.log("Sending chunks...");
let i = 0;
function sendChunk() {
    if (i < payload.length) {
        interceptor.write(payload[i]);
        i++;
        setImmediate(sendChunk);
    } else {
        interceptor.end();
    }
}
sendChunk();
