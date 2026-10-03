'use strict';
/* [app/server.js] Dịch vụ local cho LifeHorizon — Node thuần, KHÔNG dependency (thay _serve.ps1 làm
   `npm run serve`; PS cũ còn ở `npm run serve:static`). Chỉ nghe 127.0.0.1, dò cổng 8300–8310.
   - File tĩnh từ thư mục app/ (như server PS cũ).
   - API hồ sơ profile tại /api/* — mỗi profile là MỘT file JSON trong thư mục hồ sơ
     (mặc định <dự án>/profiles, đổi bằng --profiles <đường-dẫn> hoặc biến môi trường LIFESIM_PROFILES).
     Thư mục con dành riêng: _history (bản trước mỗi lần ghi đè), _trash (bị xóa chờ khôi phục),
     _draft (bản nháp tự động theo id hồ sơ). Các file/tên bắt đầu bằng "_" không lộ qua API.
   Ghi file an toàn: ghi file tạm rồi đổi tên; trước khi ghi đè chép bản cũ vào _history;
   PUT kèm ?rev=<revision> sẽ từ chối 409 nếu file đã bị sửa bên ngoài (khác revision khách gửi). */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const OPEN_BROWSER = argvIncludes('--open');
function argvIncludes(flag) { return process.argv.slice(2).indexOf(flag) >= 0; }
function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch (e) { console.log('Khong tu mo duoc trinh duyet — mo thu cong: ' + url); }
}

const ROOT = __dirname; // thư mục app/
let PROFILES = path.resolve(ROOT, '..', 'profiles');
const argv = process.argv.slice(2);
const iFlag = argv.indexOf('--profiles');
if (iFlag >= 0 && argv[iFlag + 1]) PROFILES = path.resolve(argv[iFlag + 1]);
else if (process.env.LIFESIM_PROFILES) PROFILES = path.resolve(process.env.LIFESIM_PROFILES);

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 .()\-\u00C0-\u1EF9]{0,80}\.json$/; // tên file .json an toàn, không "_", không ".."
const ID_RE = /^[A-Za-z0-9\-]{1,120}$/; // id hồ sơ / id draft
const MAX_BODY = 64 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

function ensureDirs() {
  for (const d of [PROFILES, path.join(PROFILES, '_history'), path.join(PROFILES, '_trash'), path.join(PROFILES, '_draft')]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function safeResolve(base, name) {
  const p = path.resolve(base, name);
  return p === base || p.startsWith(base + path.sep) ? p : null;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('File quá lớn')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
/* Đọc + parse một file profile; trả {entry, full} — entry để liệt kê, full là object gốc */
function readProfile(file) {
  const full = path.join(PROFILES, file);
  const st = fs.statSync(full);
  let obj = null, err = null;
  try { obj = JSON.parse(fs.readFileSync(full, 'utf8')); } catch (e) { err = e.message; }
  const entry = { file, size: st.size, mtime: st.mtime.toISOString() };
  if (err || !obj || typeof obj !== 'object') { entry.ok = false; entry.error = err ? ('JSON lỗi: ' + err) : 'JSON không phải đối tượng'; return { entry, full: null }; }
  entry.ok = true;
  entry.id = typeof obj.id === 'string' ? obj.id : '';
  entry.name = typeof obj.name === 'string' ? obj.name : '';
  entry.description = typeof obj.description === 'string' ? obj.description : '';
  entry.revision = Number.isInteger(obj.revision) ? obj.revision : null;
  entry.createdAt = typeof obj.createdAt === 'string' ? obj.createdAt : null;
  entry.updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : null;
  entry.schemaVersion = obj.state && Number.isInteger(obj.state.schemaVersion) ? obj.state.schemaVersion : null;
  return { entry, full: obj };
}
function listProfiles() {
  ensureDirs();
  return fs.readdirSync(PROFILES).filter(f => NAME_RE.test(f) && fs.statSync(path.join(PROFILES, f)).isFile())
    .map(f => { try { return readProfile(f).entry; } catch (e) { return { file: f, ok: false, error: e.message }; } })
    .sort((a, b) => String(b.mtime || '').localeCompare(String(a.mtime || '')));
}
/* Ghi profile: file tạm → kiểm tra parse lại → đổi tên đè file chính; bản cũ vào _history */
function saveProfileFile(name, text, opts) {
  ensureDirs();
  const target = safeResolve(PROFILES, name);
  if (!target || !NAME_RE.test(name)) return { code: 400, body: { ok: false, error: 'Tên file không hợp lệ' } };
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { return { code: 400, body: { ok: false, error: 'Nội dung JSON không đọc được: ' + e.message } }; }
  if (!parsed || typeof parsed !== 'object' || !parsed.state) return { code: 400, body: { ok: false, error: 'Thiếu khối "state" — không phải hồ sơ LifeHorizon' } };
  const exists = fs.existsSync(target);
  let curRev = null;
  if (exists) {
    try { const cur = JSON.parse(fs.readFileSync(target, 'utf8')); curRev = Number.isInteger(cur.revision) ? cur.revision : null; } catch (e) { curRev = null; }
    if (opts.rev !== undefined && opts.rev !== null && curRev !== opts.rev) {
      const st = fs.statSync(target);
      return { code: 409, body: { ok: false, error: 'File đã bị sửa từ ngoài (hoặc nơi khác) sau lần bạn mở', conflict: { revision: curRev, mtime: st.mtime.toISOString() } } };
    }
    if (opts.create) return { code: 409, body: { ok: false, error: 'Đã có file cùng tên', conflict: { revision: curRev } } };
    const stem = name.replace(/\.json$/i, '');
    fs.copyFileSync(target, path.join(PROFILES, '_history', stem + '.' + (curRev == null ? 'unknown' : curRev) + '.' + Date.now() + '.json'));
  }
  const tmp = path.join(PROFILES, '.' + name + '.tmp-' + process.pid + '-' + Date.now());
  fs.writeFileSync(tmp, text, 'utf8');
  try { JSON.parse(fs.readFileSync(tmp, 'utf8')); } catch (e) { fs.unlinkSync(tmp); return { code: 500, body: { ok: false, error: 'Ghi file tạm lỗi: ' + e.message } }; }
  fs.renameSync(tmp, target);
  const st = fs.statSync(target);
  return { code: 200, body: { ok: true, savedAt: st.mtime.toISOString(), revision: Number.isInteger(parsed.revision) ? parsed.revision : null } };
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  if (parts[1] === 'profiles' && parts.length === 2 && req.method === 'GET') return json(res, 200, { ok: true, dir: PROFILES, profiles: listProfiles() });
  if (parts[1] === 'profiles' && parts[2] === 'file' && parts[3]) {
    const name = decodeURIComponent(parts[3]);
    if (!NAME_RE.test(name)) return json(res, 400, { ok: false, error: 'Tên file không hợp lệ' });
    const target = safeResolve(PROFILES, name);
    if (!target) return json(res, 400, { ok: false, error: 'Đường dẫn không hợp lệ' });
    if (req.method === 'GET') {
      if (!fs.existsSync(target)) return json(res, 404, { ok: false, error: 'Không tìm thấy hồ sơ' });
      const text = fs.readFileSync(target, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(text);
    }
    if (req.method === 'PUT') {
      const r = saveProfileFile(name, await readBody(req), { rev: url.searchParams.has('rev') ? Number(url.searchParams.get('rev')) : null, create: url.searchParams.get('create') === '1' });
      return json(res, r.code, r.body);
    }
    if (req.method === 'DELETE') {
      if (!fs.existsSync(target)) return json(res, 404, { ok: false, error: 'Không tìm thấy hồ sơ' });
      ensureDirs();
      const stem = name.replace(/\.json$/i, '');
      fs.renameSync(target, path.join(PROFILES, '_trash', stem + '.' + Date.now() + '.json'));
      return json(res, 200, { ok: true });
    }
  }
  if (parts[1] === 'draft' && parts[2]) {
    const id = decodeURIComponent(parts[2]);
    if (!ID_RE.test(id)) return json(res, 400, { ok: false, error: 'Id không hợp lệ' });
    const target = safeResolve(path.join(PROFILES, '_draft'), id + '.json');
    if (!target) return json(res, 400, { ok: false, error: 'Đường dẫn không hợp lệ' });
    if (req.method === 'GET') {
      if (!fs.existsSync(target)) return json(res, 200, { ok: false, notFound: true });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(target, 'utf8'));
    }
    if (req.method === 'PUT') {
      ensureDirs();
      const text = await readBody(req);
      try { const o = JSON.parse(text); if (!o || !o.state) throw new Error('thiếu state'); } catch (e) { return json(res, 400, { ok: false, error: 'Bản nháp không hợp lệ: ' + e.message }); }
      fs.writeFileSync(target, text, 'utf8');
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      if (fs.existsSync(target)) fs.unlinkSync(target);
      return json(res, 200, { ok: true });
    }
  }
  return json(res, 404, { ok: false, error: 'API không tồn tại' });
}

function serveStatic(res, rel) {
  if (rel === '/') rel = '/index.html';
  const p = safeResolve(ROOT, path.normalize(rel).replace(/^([\\/])/, ''));
  if (!p) { res.writeHead(400); return res.end('bad path'); }
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404); return res.end('not found'); }
  const ext = path.extname(p).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(p).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, service: 'lifesim-profiles', dir: PROFILES });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(res, url.pathname);
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
});
let port = 8300;
server.on('error', () => {
  port++;
  if (port > 8310) { console.error('Khong mo duoc cong 8300-8310'); process.exit(1); }
  server.listen(port, '127.0.0.1');
});
ensureDirs();
server.listen(port, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + port + '/';
  console.log('LifeHorizon - Dong tien cuoc doi — ' + ROOT);
  console.log('Thu muc ho so: ' + PROFILES);
  console.log('Mo ung dung tai ' + url);
  if (OPEN_BROWSER) openBrowser(url);
});
