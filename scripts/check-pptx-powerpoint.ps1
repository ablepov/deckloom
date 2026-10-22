param([Parameter(Mandatory=$true)][string]$Result)
$ErrorActionPreference = 'Stop'
$e3Result = Get-Content -LiteralPath $Result -Raw -Encoding UTF8 | ConvertFrom-Json
if ($e3Result.status -ne 'succeeded') { throw 'Public export must succeed first' }
$e3Output = @($e3Result.outputs | Where-Object format -eq 'pptx')[0]
$e3File = $e3Output.file
$e3Folder = Join-Path (Split-Path $Result) 'powerpoint'
[void][IO.Directory]::CreateDirectory($e3Folder)
$e3Application = New-Object -ComObject PowerPoint.Application
$e3Presentation = $null
try {
  $e3Presentation = $e3Application.Presentations.Open($e3File, 0, 0, 0)
  $e3Slides = @()
  foreach ($e3Slide in $e3Presentation.Slides) {
    $e3Shapes = @()
    foreach ($e3Shape in $e3Slide.Shapes) {
      $e3Text = ''; $e3Lines = @(); $e3Runs = @(); $e3Bound = $null
      if ($e3Shape.HasTextFrame -eq -1 -and $e3Shape.TextFrame.HasText -eq -1) {
        $e3Text = $e3Shape.TextFrame.TextRange.Text
        $e3Range = $e3Shape.TextFrame2.TextRange
        $e3Bound = @{left=$e3Range.BoundLeft;top=$e3Range.BoundTop;width=$e3Range.BoundWidth;height=$e3Range.BoundHeight}
        for ($e3Index = 1; $e3Index -le $e3Shape.TextFrame.TextRange.Lines().Count; $e3Index++) { $e3Lines += $e3Shape.TextFrame.TextRange.Lines($e3Index,1).Text }
        foreach ($e3Run in $e3Shape.TextFrame.TextRange.Runs()) { $e3Runs += @{text=$e3Run.Text;font=$e3Run.Font.Name;size=$e3Run.Font.Size;bold=$e3Run.Font.Bold;italic=$e3Run.Font.Italic;underline=$e3Run.Font.Underline} }
      }
      $e3Shapes += @{name=$e3Shape.Name;type=[int]$e3Shape.Type;left=$e3Shape.Left;top=$e3Shape.Top;width=$e3Shape.Width;height=$e3Shape.Height;text=$e3Text;lines=$e3Lines;runs=$e3Runs;textBounds=$e3Bound;zOrder=$e3Shape.ZOrderPosition}
    }
    $e3Slide.Export((Join-Path $e3Folder ('slide-' + $e3Slide.SlideIndex + '.png')), 'PNG', 960, 540)
    $e3Slides += @{index=$e3Slide.SlideIndex;shapes=$e3Shapes}
  }
  # Windows PowerShell 5.1 reads BOM-less script literals as ANSI. Decode UTF-8 explicitly.
  $e3EditText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('0J/RgNCw0LLQutCwIOKAlCDRgdC+0YXRgNCw0L3QtdC90L4='))
  $e3Presentation.Slides.Item(1).Shapes.Item('title').TextFrame.TextRange.Text = $e3EditText
  $e3Presentation.Slides.Item(2).Shapes.Item('back').Fill.ForeColor.RGB = 0x66CC22
  $e4GridEdits = @()
  for ($e4Index = 1; $e4Index -le $e3Output.slides.Count; $e4Index++) {
    $e4Metadata = $e3Output.slides[$e4Index - 1]
    if ($e4Metadata.id -notin @('grid','grid-wrap')) { continue }
    $e4Slide = $e3Presentation.Slides.Item($e4Index)
    $e4Slide.Shapes.Item('card-one-title').TextFrame.TextRange.Text = $e3EditText
    $e4Slide.Shapes.Item('card-one').Fill.ForeColor.RGB = 0x66CC22
    $e4GridEdits += @{slideIndex=$e4Index;slideId=$e4Metadata.id;textShape='card-one-title';fillShape='card-one'}
  }
  $e3Edited = Join-Path $e3Folder 'edited.pptx'
  $e3Presentation.SaveCopyAs($e3Edited,24)
  $e3Presentation.Close(); $e3Presentation = $null
  $e3Presentation = $e3Application.Presentations.Open($e3Edited,-1,0,0)
  $e3ActualEdit = $e3Presentation.Slides.Item(1).Shapes.Item('title').TextFrame.TextRange.Text
  if ($e3ActualEdit -ne $e3EditText) { throw 'Text edit lost' }
  if ($e3Presentation.Slides.Item(2).Shapes.Item('back').Fill.ForeColor.RGB -ne 0x66CC22) { throw 'Fill edit lost' }
  foreach ($e4Edit in $e4GridEdits) {
    $e4Slide = $e3Presentation.Slides.Item($e4Edit.slideIndex)
    if ($e4Slide.Shapes.Item($e4Edit.textShape).TextFrame.TextRange.Text -ne $e3EditText) { throw 'Grid text edit lost' }
    if ($e4Slide.Shapes.Item($e4Edit.fillShape).Fill.ForeColor.RGB -ne 0x66CC22) { throw 'Grid fill edit lost' }
    $e4Slide.Export((Join-Path $e3Folder ('edited-grid-' + $e4Edit.slideIndex + '.png')),'PNG',960,540)
  }
  $e3Presentation.Slides.Item(1).Export((Join-Path $e3Folder 'edited-text.png'),'PNG',960,540)
  $e3Presentation.Slides.Item(2).Export((Join-Path $e3Folder 'edited-shape.png'),'PNG',960,540)
  @{application='Microsoft PowerPoint';version=$e3Application.Version;source=$e3File;widthPt=$e3Presentation.PageSetup.SlideWidth;heightPt=$e3Presentation.PageSetup.SlideHeight;slides=$e3Slides;editReopen=@{text=$true;shape=$true};gridEditReopen=$e4GridEdits;actualEditedText=$e3ActualEdit;visibleNoRepairObservation=$false;verification='COM open/render/edit/save/reopen; visible UI checkpoint remains separate'} | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $e3Folder 'verification.json') -Encoding UTF8
  Write-Output 'PowerPoint COM: opened, rendered, edited, saved, reopened'
} finally {
  if ($null -ne $e3Presentation) { $e3Presentation.Saved=-1; $e3Presentation.Close(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($e3Presentation) }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($e3Application)
}
