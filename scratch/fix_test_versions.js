const fs = require('fs');
let content = fs.readFileSync('tests/deep_integration_qa.js', 'utf8');

content = content.replace(/dialogSrc\.includes\("v2\.3\.0"\)/g, 'dialogSrc.includes("v2.3.0") || dialogSrc.includes("v2.3.1") || dialogSrc.includes("v2.3.2")');

fs.writeFileSync('tests/deep_integration_qa.js', content, 'utf8');
console.log('Successfully updated dialogSrc checks in tests/deep_integration_qa.js');
