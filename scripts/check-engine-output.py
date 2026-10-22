"""Independent public export verification for F2-G1 and the bounded E4 matrix."""
import hashlib, io, json, posixpath, sys, zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
from pypdf import PdfReader
P='http://schemas.openxmlformats.org/presentationml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS={'p':P,'a':A,'r':R}
def digest(data): return hashlib.sha256(data).hexdigest()
def check(file, office):
    result=json.loads(file.read_text(encoding='utf-8-sig')); assert result['status']=='succeeded'
    manifest=json.loads(Path(result['bundle']['manifest']).read_text(encoding='utf-8'))
    base=Path(result['bundle']['directory']); scenes=json.loads((base/manifest['pptx']['prepared']).read_text(encoding='utf-8'))
    pptx=next(o for o in result['outputs'] if o['format']=='pptx'); data=Path(pptx['file']).read_bytes(); assert digest(data)==pptx['sha256']
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names=archive.namelist(); assert len(names)==len(set(names)) and archive.testzip() is None
        files={n:archive.read(n) for n in names if not n.endswith('/')}
    trees={n:ET.fromstring(b) for n,b in files.items() if n.endswith(('.xml','.rels'))}
    relations={}
    for name,tree in trees.items():
        if name.endswith('.rels'):
            entries={}; parent=posixpath.dirname(posixpath.dirname(name))
            for node in tree:
                assert not node.get('TargetMode') and node.get('Id') not in entries
                target=posixpath.normpath(posixpath.join(parent,node.get('Target'))).lstrip('/'); assert target in files
                entries[node.get('Id')]=target
            relations[name]=entries
    ct=trees['[Content_Types].xml']; assert all(n.get('PartName').lstrip('/') in files for n in ct if n.tag.endswith('}Override'))
    for name,bytes_ in files.items():
        if name.endswith('.png'): image=Image.open(io.BytesIO(bytes_)); assert image.format=='PNG'; image.verify()
    size=trees['ppt/presentation.xml'].find('p:sldSz',NS); assert [int(size.get(k))/9525 for k in ['cx','cy']]==[scenes[0]['width'],scenes[0]['height']]
    for i,scene in enumerate(scenes,1):
        shapes=list(trees[f'ppt/slides/slide{i}.xml'].find('p:cSld/p:spTree',NS))[2:]
        assert len(shapes)==len(scene['objects']); converted=manifest['pptx']['conversion']['slides'][i-1]
        assert converted['slideId']==scene['slideId']; source=converted['sourceDocument']; assert digest((base/source['path']).read_bytes())==source['sha256']
        for obj,shape,mapping in zip(scene['objects'],shapes,converted['objects']):
            assert shape.find('.//p:cNvPr',NS).get('name')==obj['id'] and mapping['verified']
            transform=shape.find('p:xfrm' if obj['kind']=='table' else 'p:spPr/a:xfrm',NS)
            off=transform.find('a:off',NS); ext=transform.find('a:ext',NS)
            assert all(abs(float(actual)/9525-obj[k])<.01 for k,actual in zip(['x','y','w','h'],[off.get('x'),off.get('y'),ext.get('cx'),ext.get('cy')]))
            if obj['kind']=='text': assert '\n'.join(''.join(p.itertext()) for p in shape.findall('p:txBody/a:p',NS))==obj['text']
            elif obj['kind']=='table':
                table=shape.find('.//a:tbl',NS); assert table is not None
                assert len(table.findall('a:tr',NS))==len(obj['rows'])
                assert all(abs(int(c.get('w'))/9525-v)<.01 for c,v in zip(table.findall('a:tblGrid/a:gridCol',NS),obj['columnWidths']))
                for expected,row in zip(obj['rows'],table.findall('a:tr',NS)):
                    cells=row.findall('a:tc',NS); assert len(cells)==len(expected)
                    for cell,value in zip(cells,expected):
                        assert ''.join(t.text or '' for t in cell.findall('.//a:t',NS))==value['text']
                        assert int(cell.find('.//a:spcPts',NS).get('val'))==round(value['lineHeight']*75)
            elif obj['kind']=='connector': assert shape.tag=='{'+P+'}cxnSp' and shape.find('p:spPr/a:prstGeom',NS).get('prst')=='line'
            elif obj['kind']=='image':
                links=relations[f'ppt/slides/_rels/slide{i}.xml.rels']; part=links[shape.find('.//a:blip',NS).get('{'+R+'}embed')]
                assert files[part].startswith(b'\x89PNG\r\n\x1a\n')
                if obj['mediaType']=='image/png': assert digest(files[part])==obj['sha256']
                else:
                    svg=next(n for n in shape.iter() if n.tag.endswith('}svgBlip')); primary=links[svg.get('{'+R+'}embed')]; assert digest(files[primary])==obj['sha256']
                    if 'crop' in obj: assert Image.open(io.BytesIO(files[part])).size==(obj['crop']['naturalWidth'],obj['crop']['naturalHeight'])
                if 'crop' in obj:
                    crop=shape.find('.//a:srcRect',NS); natural=obj['crop']; scale=max(obj['w']/natural['naturalWidth'],obj['h']/natural['naturalHeight'])
                    expected=[(1-obj['w']/(natural['naturalWidth']*scale))/2,(1-obj['h']/(natural['naturalHeight']*scale))/2]
                    assert all(abs(int(crop.get(k))-v*100000)<=1 for k,v in zip(['l','r','t','b'],[expected[0],expected[0],expected[1],expected[1]]))
            for paragraph in shape.findall('.//a:p',NS):
                properties=paragraph.findall('a:pPr',NS); assert len(properties)<=1 and (not properties or list(paragraph)[0] is properties[0])
        for raster in converted['rasterizedObjects']: assert raster['containsText'] is False and next(o for o in scene['objects'] if o['id']==raster['sourceId'])['kind']=='image'
    pdf=PdfReader(next(o for o in result['outputs'] if o['format']=='pdf')['file']); assert len(pdf.pages)==len(scenes)
    for scene,page in zip(scenes,pdf.pages): assert abs(float(page.mediabox.width)-scene['width']*.75)<.5 and abs(float(page.mediabox.height)-scene['height']*.75)<.5
    report={'status':'passed','slides':len(scenes),'independentParsers':['ElementTree','zipfile','Pillow','pypdf'],'office':False,'visibleNoRepairObservation':False}
    if office:
        evidence=json.loads((file.parent/'powerpoint/verification.json').read_text(encoding='utf-8-sig')); assert evidence['status']=='passed' and evidence['editReopen']
        assert evidence['source']==pptx['file'] and len(evidence['slides'])==len(scenes)
        assert abs(evidence['widthPt']-scenes[0]['width']*.75)<.01 and abs(evidence['heightPt']-scenes[0]['height']*.75)<.01
        comparisons=[]
        for i,(scene,slide) in enumerate(zip(scenes,evidence['slides']),1):
            assert [o['id'] for o in scene['objects']]==[s['name'] for s in slide['shapes']]
            for obj,shape in zip(scene['objects'],slide['shapes']):
                assert all(abs(shape[k]/.75-obj[v])<.1 for k,v in [('left','x'),('top','y'),('width','w'),('height','h')]),(obj['id'],shape)
                if obj['kind']=='text':
                    assert shape['text'].replace('\r','\n')==obj['text']
                    assert all(run['font']=='Arial' for run in shape['runs'] if run['text'].strip())
                if obj['kind']=='table':
                    assert len(obj['rows'])==len(shape['cells'])
                    for row,cells in zip(obj['rows'],shape['cells']):
                        assert [c['text'] for c in cells]==[c['text'] for c in row]
                        assert all(c['font']=='Arial' and abs(c['size']-v['size']*.75)<.01 for c,v in zip(cells,row))
            png=next(o for o in result['outputs'] if o['format']=='png' and o['slideId']==scene['slideId'])
            browser=Image.open(png['file']).convert('RGB'); native=Image.open(file.parent/f'powerpoint/slide-{i}.png').convert('RGB'); assert native.size==browser.size==(scene['width'],scene['height'])
            mae=sum(ImageStat.Stat(ImageChops.difference(browser,native)).mean)/3
            comparisons.append({'slideId':scene['slideId'],'pixelMAE':round(mae,3)})
        with zipfile.ZipFile(file.parent/'powerpoint/edited.pptx') as edited: assert edited.testzip() is None; [ET.fromstring(edited.read(n)) for n in edited.namelist() if n.endswith(('.xml','.rels'))]
        report.update(office=True,nativeEditSaveReopen=True,edits=evidence['edits'],renderComparisons=comparisons)
    (file.parent/'independent-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8'); print(json.dumps({k:v for k,v in report.items() if k!='edits'},ensure_ascii=False))
if __name__=='__main__': check(Path(sys.argv[1]),'--office' in sys.argv)

