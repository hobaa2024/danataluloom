
const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\Danataluloom school\\Downloads\\New folder (4)\\Danat1\\Danat1\\contract.js', 'utf8');

function checkBraces(code) {
    let balance = 0;
    let lineNum = 1;
    let i = 0;

    while (i < code.length) {
        const char = code[i];
        if (char === '\n') lineNum++;

        // Skip strings and comments to get accurate brace count
        if (char === '"' || char === "'") {
            const quote = char;
            i++;
            while (i < code.length && code[i] !== quote) {
                if (code[i] === '\\') i++;
                if (code[i] === '\n') lineNum++;
                i++;
            }
        } else if (char === '`') {
            i++;
            while (i < code.length && code[i] !== '`') {
                if (code[i] === '\\') i++;
                if (code[i] === '$' && code[i + 1] === '{') {
                    // This is a nested brace, but for a simple check let's count it
                    balance++;
                    i++;
                }
                if (code[i] === '\n') lineNum++;
                i++;
            }
        } else if (char === '/' && code[i + 1] === '/') {
            while (i < code.length && code[i] !== '\n') i++;
            lineNum++;
        } else if (char === '/' && code[i + 1] === '*') {
            i += 2;
            while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
                if (code[i] === '\n') lineNum++;
                i++;
            }
            i++;
        } else if (char === '{') {
            balance++;
        } else if (char === '}') {
            balance--;
        }
        i++;
    }
    console.log(`Final balance: ${balance}`);
}
checkBraces(content);
