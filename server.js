const http = require('http');
const fs = require('fs');
const path = require('path');

const port = 3000;
const publicDir = path.join(__dirname, '.');

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') {
        res.writeHead(404);
        res.end();
        return;
    }

    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(publicDir, filePath);

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('File not found');
            return;
        }

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
