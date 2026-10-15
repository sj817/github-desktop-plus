$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$assetDir = Join-Path $repoRoot 'apps/gdp/assets'
$sourcePath = Join-Path $repoRoot 'docs/design/icon-plus/github-desktop-plus-v3.png'
$sourceImage = [Drawing.Bitmap]::FromFile($sourcePath)

function Get-IconPng([int]$Size) {
    $bitmap = [Drawing.Bitmap]::new($Size, $Size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $attributes = [Drawing.Imaging.ImageAttributes]::new()
    $stream = [IO.MemoryStream]::new()
    try {
        $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $attributes.SetWrapMode([Drawing.Drawing2D.WrapMode]::TileFlipXY)
        $graphics.DrawImage($sourceImage, [Drawing.Rectangle]::new(0, 0, $Size, $Size),
            0, 0, $sourceImage.Width, $sourceImage.Height, [Drawing.GraphicsUnit]::Pixel, $attributes)
        $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
        return ,$stream.ToArray()
    } finally {
        $stream.Dispose()
        $attributes.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

try {
    [IO.File]::WriteAllBytes((Join-Path $assetDir 'gdp-icon.png'), (Get-IconPng 1024))

    # PNG-compressed ICO frames cover Windows taskbar, Explorer and common DPI scales.
    $frames = @(16, 20, 24, 32, 40, 48, 64, 96, 128, 256) | ForEach-Object {
        [PSCustomObject]@{ Size = $_; Bytes = Get-IconPng $_ }
    }
    $iconStream = [IO.MemoryStream]::new()
    $writer = [IO.BinaryWriter]::new($iconStream)
    try {
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]$frames.Count)
        $offset = 6 + 16 * $frames.Count
        foreach ($frame in $frames) {
            $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
            $writer.Write([byte]$dimension)
            $writer.Write([byte]$dimension)
            $writer.Write([byte]0)
            $writer.Write([byte]0)
            $writer.Write([uint16]1)
            $writer.Write([uint16]32)
            $writer.Write([uint32]$frame.Bytes.Length)
            $writer.Write([uint32]$offset)
            $offset += $frame.Bytes.Length
        }
        foreach ($frame in $frames) {
            $writer.Write([byte[]]$frame.Bytes)
        }
        [IO.File]::WriteAllBytes((Join-Path $assetDir 'gdp.ico'), $iconStream.ToArray())
    } finally {
        $writer.Dispose()
        $iconStream.Dispose()
    }

    $splash = [Drawing.Bitmap]::new(900, 600, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $splashGraphics = [Drawing.Graphics]::FromImage($splash)
    try {
        $splashGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $splashGraphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $splashGraphics.DrawImage($sourceImage, 270, 52, 360, 360)
        $splash.Save((Join-Path $assetDir 'installer-splash.png'), [Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $splashGraphics.Dispose()
        $splash.Dispose()
    }

    [IO.File]::WriteAllBytes((Join-Path $repoRoot 'apps/site/logo.png'), (Get-IconPng 256))
    [IO.File]::WriteAllBytes((Join-Path $repoRoot 'apps/settings-ui/src/assets/logo.png'), (Get-IconPng 128))
} finally {
    $sourceImage.Dispose()
}

Write-Output 'Prepared GDP icon, Windows ICO, installer splash, and website logo.'
