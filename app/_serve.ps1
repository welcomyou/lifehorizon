# Server tinh don gian cho thu muc app — chay: powershell -File _serve.ps1
$root = $PSScriptRoot
if(-not $root){ $root = 'D:\App\dongtien\app' }
$listener = New-Object System.Net.HttpListener
$port = 8300
while($true){
  try { $listener = New-Object System.Net.HttpListener; $listener.Prefixes.Add("http://127.0.0.1:$port/"); $listener.Start(); break }
  catch { if($port -ge 8310){ Write-Host "Khong mo duoc cong 8300-8310: $_"; exit 1 }; $port++ }
}
Write-Host "Serving $root at http://127.0.0.1:$port/"
while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $file = $ctx.Request.Url.AbsolutePath
    if ($file -eq '/') { $file = '/index.html' }
    $path = Join-Path $root ($file -replace '/', '\')
    if (($file -notmatch '\.\.') -and (Test-Path $path -PathType Leaf)) {
      $bytes = [System.IO.File]::ReadAllBytes($path)
      $ext = [System.IO.Path]::GetExtension($path)
      $mime = switch ($ext) { '.html' {'text/html; charset=utf-8'} '.js' {'text/javascript'} '.css' {'text/css'} default {'application/octet-stream'} }
      $ctx.Response.ContentType = $mime
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes('not found')
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    }
    $ctx.Response.Close()
  } catch { break }
}
