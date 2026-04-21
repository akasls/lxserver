const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execSync, spawnSync } = require('child_process');
const unzipper = require('unzipper');

/**
 * 自动下载当前平台对应的 Chromaprint fpcalc 二进制文件
 * 目标目录: /public/music/bin/
 */

const TARGET_DIR = path.join(__dirname, '../public/music/bin');
const GITHUB_RELEASES_URL = 'https://github.com/acoustid/chromaprint/releases/latest';

// 获取最新版本号
function getLatestVersion() {
    return new Promise((resolve, reject) => {
        https.get(GITHUB_RELEASES_URL, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                const location = res.headers.location;
                const versionMatch = location.match(/tag\/(v[\d.]+)/);
                if (versionMatch) {
                    resolve(versionMatch[1]);
                } else {
                    reject(new Error('无法解析最新版本号: ' + location));
                }
            } else {
                reject(new Error('获取最新版本失败，状态码: ' + res.statusCode));
            }
        }).on('error', reject);
    });
}

// 根据平台获取对应的下载文件名
function getDownloadFileName(version) {
    const platform = os.platform(); // win32, linux, darwin
    const arch = os.arch();         // x64, arm64
    const v = version.replace('v', '');

    if (platform === 'win32' && arch === 'x64') {
        return `chromaprint-fpcalc-${v}-windows-x86_64.zip`;
    }
    if (platform === 'linux') {
        if (arch === 'x64') return `chromaprint-fpcalc-${v}-linux-x86_64.tar.gz`;
        if (arch === 'arm64') return `chromaprint-fpcalc-${v}-linux-arm64.tar.gz`;
    }
    if (platform === 'darwin') {
        return `chromaprint-fpcalc-${v}-macos-universal.tar.gz`;
    }
    return null;
}

// 下载文件
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                downloadFile(res.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`下载失败，状态码: ${res.statusCode}`));
                return;
            }
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => {
                file.close(() => resolve());
            });
            file.on('error', (err) => {
                fs.unlink(dest, () => reject(err));
            });
        }).on('error', reject);
    });
}

async function extractZip(filePath, destDir) {
    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(unzipper.Extract({ path: destDir }))
            .on('close', resolve)
            .on('error', reject);
    });
}

/**
 * 递归查找文件名
 */
function findFile(dir, fileName) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            const found = findFile(fullPath, fileName);
            if (found) return found;
        } else if (file === fileName) {
            return fullPath;
        }
    }
    return null;
}

async function main() {
    try {
        // 环境检查
        const checkGlobal = spawnSync(os.platform() === 'win32' ? 'where' : 'which', ['fpcalc'], { encoding: 'utf8' });
        if (checkGlobal.status === 0) {
            console.log('检测到系统中已安装 fpcalc，跳过自动下载。');
            return;
        }

        if (!fs.existsSync(TARGET_DIR)) {
            fs.mkdirSync(TARGET_DIR, { recursive: true });
        }

        console.log('正在查询最新版本...');
        const version = await getLatestVersion();
        console.log(`最新版本: ${version}`);

        const fileName = getDownloadFileName(version);
        if (!fileName) return;

        const downloadUrl = `https://github.com/acoustid/chromaprint/releases/download/${version}/${fileName}`;
        const tempFilePath = path.join(TARGET_DIR, fileName);

        console.log(`开始下载: ${fileName}...`);
        await downloadFile(downloadUrl, tempFilePath);
        console.log('下载完成。');

        console.log('开始解压并安装...');
        const binaryName = os.platform() === 'win32' ? 'fpcalc.exe' : 'fpcalc';

        if (fileName.endsWith('.zip')) {
            await extractZip(tempFilePath, TARGET_DIR);
        } else {
            execSync(`tar -xzf "${tempFilePath}" -C "${TARGET_DIR}"`);
        }

        // 自动查找解压后的二进制文件并移动到 TARGET_DIR 根目录
        const fpcalcPath = findFile(TARGET_DIR, binaryName);
        if (fpcalcPath && fpcalcPath !== path.join(TARGET_DIR, binaryName)) {
            fs.renameSync(fpcalcPath, path.join(TARGET_DIR, binaryName));
            console.log(`已将二进制文件移动至: ${path.join(TARGET_DIR, binaryName)}`);
        }

        // 清理解压出的多余文件夹（只保留 fpcalc）
        const items = fs.readdirSync(TARGET_DIR);
        for (const item of items) {
            const fullPath = path.join(TARGET_DIR, item);
            if (fs.statSync(fullPath).isDirectory()) {
                fs.rmSync(fullPath, { recursive: true, force: true });
            } else if (item === fileName) {
                fs.unlinkSync(fullPath);
            }
        }

        if (os.platform() !== 'win32') {
            fs.chmodSync(path.join(TARGET_DIR, binaryName), '755');
        }

        console.log('安装成功！');

    } catch (error) {
        console.error('安装失败:', error.message);
        process.exit(1);
    }
}

main();
