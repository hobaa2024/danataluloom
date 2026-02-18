
const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\Danataluloom school\\Downloads\\New folder (4)\\Danat1\\Danat1\\contract.js', 'utf8');

function checkBraces(code) {
    let balance = 0;
    let inString = false;
    let stringChar = '';
    let inRegex = false;
    let i = 0;
    let lineNum = 1;

    while (i < code.length) {
        const char = code[i];
        if (char === '\n') lineNum++;

        if (!inString && !inRegex) {
            if (char === '/' && code[i + 1] === '/') {
                while (i < code.length && code[i] !== '\n') i++;
                lineNum++;
                continue;
            }
            if (char === '/' && code[i + 1] === '*') {
                i += 2;
                while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
                    if (code[i] === '\n') lineNum++;
                    i++;
                }
                i += 2;
                continue;
            }
            if (char === "'" || char === '"' || char === '`') {
                inString = true;
                stringChar = char;
            } else if (char === '/' && !/[a-zA-Z0-9_$)]/.test(code[i - 1] || ' ')) {
                inRegex = true;
            } else if (char === '{') {
                balance++;
            } else if (char === '}') {
                balance--;
            }
        } else if (inString) {
            if (char === '\\') {
                i++;
            } else if (stringChar === '`' && char === '$' && code[i + 1] === '{') {
                // Template literal interpolation starts
                balance++;
                i++;
            } else if (char === stringChar) {
                inString = false;
            }
        } else if (inRegex) {
            if (char === '\\') i++;
            else if (char === '/') inRegex = false;
        }
        i++;
    }
    console.log(`Final balance: ${balance}`);
}
checkBraces(content);
