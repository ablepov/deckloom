param([Parameter(Mandatory=$true)][string]$Result)
$ErrorActionPreference = 'Stop'
$Result = (Resolve-Path -LiteralPath $Result).Path
$receipt = Get-Content -LiteralPath $Result -Raw -Encoding UTF8 | ConvertFrom-Json
if ($receipt.status -ne 'succeeded') { throw 'Export must succeed before Office verification' }
$manifest = Get-Content -LiteralPath $receipt.bundle.manifest -Raw -Encoding UTF8 | ConvertFrom-Json
$scenes = Get-Content -LiteralPath (Join-Path $receipt.bundle.directory $manifest.pptx.prepared) -Raw -Encoding UTF8 | ConvertFrom-Json
$file = @($receipt.outputs | Where-Object format -eq 'pptx')[0].file
$folder = Join-Path (Split-Path $Result) 'powerpoint'
[void][IO.Directory]::CreateDirectory($folder)
$app = New-Object -ComObject PowerPoint.Application
$deck = $null
$editedText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('0J/RgNCw0LLQutCwIOKAlCDRgdC+0YXRgNCw0L3QtdC90L4='))
try {
  $deck = $app.Presentations.Open($file, 0, 0, 0)
  if ($deck.Slides.Count -ne $scenes.Count) { throw 'Office slide count differs' }
  $slides = @(); $edits = @()
  for ($i = 1; $i -le $deck.Slides.Count; $i++) {
    $slide = $deck.Slides.Item($i); $scene = $scenes[$i-1]; $shapes = @()
    if ($slide.Shapes.Count -ne $scene.objects.Count) { throw 'Office native shape count differs' }
    $editedPlainText = $false; $editedFill = $false
    foreach ($obj in $scene.objects) {
      $shape = $slide.Shapes.Item($obj.id)
      $data = @{name=$shape.Name;type=[int]$shape.Type;left=$shape.Left;top=$shape.Top;width=$shape.Width;height=$shape.Height;zOrder=$shape.ZOrderPosition}
      if ($obj.kind -eq 'text') {
        $data.text = $shape.TextFrame.TextRange.Text
        $data.font = $shape.TextFrame.TextRange.Font.Name
        $data.runs = @(); foreach ($run in $shape.TextFrame.TextRange.Runs()) { $data.runs += @{text=$run.Text;font=$run.Font.Name;size=$run.Font.Size} }
        $data.lines = @(); for ($l=1; $l -le $shape.TextFrame.TextRange.Lines().Count; $l++) { $data.lines += $shape.TextFrame.TextRange.Lines($l,1).Text }
        if (-not $editedPlainText) { $shape.TextFrame.TextRange.Text = $editedText; $edits += @{slide=$i;name=$obj.id;kind='text';value=$editedText}; $editedPlainText=$true }
      } elseif ($obj.kind -eq 'table') {
        if ($shape.HasTable -ne -1) { throw 'Native table lost' }
        $data.cells = @()
        for ($row=1; $row -le $shape.Table.Rows.Count; $row++) {
          $cells = @(); for ($col=1; $col -le $shape.Table.Columns.Count; $col++) {
            $cell = $shape.Table.Cell($row,$col).Shape
            $cells += @{text=$cell.TextFrame.TextRange.Text;font=$cell.TextFrame.TextRange.Font.Name;size=$cell.TextFrame.TextRange.Font.Size;left=$cell.Left;top=$cell.Top;width=$cell.Width;height=$cell.Height}
          }
          $data.cells += ,$cells
        }
        $shape.Table.Cell(2,2).Shape.TextFrame.TextRange.Text = 'edited-cell'
        $shape.Table.Cell(2,2).Shape.Fill.ForeColor.RGB = 0x66CC22
        $edits += @{slide=$i;name=$obj.id;kind='table';value='edited-cell'}
      } elseif ($obj.kind -eq 'connector') {
        if ($shape.Connector -ne -1) { throw 'Native connector lost' }
        $shape.Line.ForeColor.RGB = 0x66CC22; $edits += @{slide=$i;name=$obj.id;kind='connector';value=0x66CC22}
      } elseif ($obj.kind -eq 'rect' -and -not $editedFill) {
        $shape.Fill.ForeColor.RGB = 0x66CC22; $edits += @{slide=$i;name=$obj.id;kind='rect';value=0x66CC22}; $editedFill=$true
      } elseif ($obj.kind -eq 'image' -and $null -ne $obj.crop) {
        $data.cropLeft=$shape.PictureFormat.CropLeft; $data.cropTop=$shape.PictureFormat.CropTop
        $shape.PictureFormat.CropLeft = $shape.PictureFormat.CropLeft + 1
        $edits += @{slide=$i;name=$obj.id;kind='crop';value=$shape.PictureFormat.CropLeft}
      }
      $shapes += $data
    }
    # Export the original first: edits above are checked separately below, so reopen
    # the original in a read-only second presentation for a faithful rendering.
    $slides += @{index=$i;shapes=$shapes}
  }
  $edited = Join-Path $folder 'edited.pptx'; $deck.SaveCopyAs($edited,24); $deck.Saved=-1; $deck.Close(); $deck=$null
  $deck=$app.Presentations.Open($file,-1,0,0)
  for ($i=1; $i -le $deck.Slides.Count; $i++) { $deck.Slides.Item($i).Export((Join-Path $folder ('slide-'+$i+'.png')),'PNG',[int]$scenes[$i-1].width,[int]$scenes[$i-1].height) }
  $width=$deck.PageSetup.SlideWidth; $height=$deck.PageSetup.SlideHeight; $deck.Close(); $deck=$null
  $deck=$app.Presentations.Open($edited,-1,0,0)
  foreach ($edit in $edits) {
    $shape=$deck.Slides.Item($edit.slide).Shapes.Item($edit.name)
    switch ($edit.kind) {
      'text' { if ($shape.TextFrame.TextRange.Text -ne $edit.value) { throw 'Native text edit lost' } }
      'rect' { if ($shape.Fill.ForeColor.RGB -ne $edit.value) { throw 'Native fill edit lost' } }
      'table' { if ($shape.Table.Cell(2,2).Shape.TextFrame.TextRange.Text -ne $edit.value -or $shape.Table.Cell(2,2).Shape.Fill.ForeColor.RGB -ne 0x66CC22) { throw 'Native table edit lost' } }
      'connector' { if ($shape.Connector -ne -1 -or $shape.Line.ForeColor.RGB -ne $edit.value) { throw 'Native connector edit lost' } }
      'crop' { if ([Math]::Abs($shape.PictureFormat.CropLeft - $edit.value) -gt .02) { throw 'Native crop edit lost' } }
    }
  }
  @{status='passed';application='Microsoft PowerPoint';version=$app.Version;source=$file;widthPt=$width;heightPt=$height;slides=$slides;editReopen=$true;edits=$edits;visibleNoRepairObservation=$false;verification='COM open/render/native edits/save/reopen; no interactive UI claim'} | ConvertTo-Json -Depth 18 | Set-Content -LiteralPath (Join-Path $folder 'verification.json') -Encoding UTF8
  Write-Output 'PowerPoint COM engine/matrix: passed'
} finally {
  if ($null -ne $deck) { $deck.Saved=-1; $deck.Close(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($deck) }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
