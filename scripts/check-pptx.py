"""Independent E3 acceptance using stdlib XML/ZIP, Pillow, pypdf and actual Office evidence."""
import hashlib, io, json, posixpath, sys, zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image
from pypdf import PdfReader
P='http://schemas.openxmlformats.org/presentationml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS={'p':P,'a':A,'r':R}
def digest(data): return hashlib.sha256(data).hexdigest()
def check(result_file, office=False):
    result=json.loads(result_file.read_text(encoding='utf-8-sig')); assert result['status']=='succeeded'
    manifest=json.loads(Path(result['bundle']['manifest']).read_text(encoding='utf-8'))
    base=Path(result['bundle']['directory']); scenes=json.loads((base/manifest['pptx']['prepared']).read_text(encoding='utf-8'))
    outputs={o['format']:o for o in result['outputs'] if 'slideId' not in o}
    data=Path(outputs['pptx']['file']).read_bytes(); assert digest(data)==outputs['pptx']['sha256']
    conversion=manifest['pptx']['conversion'];assert conversion['version']==1 and len(conversion['slides'])==len(scenes)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names=archive.namelist(); assert len(names)==len(set(names)); assert archive.testzip() is None
        files={name:archive.read(name) for name in names if not name.endswith('/')}
    trees={name:ET.fromstring(data) for name,data in files.items() if name.endswith(('.xml','.rels'))}
    ct=trees['[Content_Types].xml']; defaults={n.get('Extension'):n.get('ContentType') for n in ct if n.tag.endswith('}Default')}; overrides={n.get('PartName'):n.get('ContentType') for n in ct if n.tag.endswith('}Override')}
    assert all(name.lstrip('/') in files for name in overrides)
    relations={}
    for name,tree in trees.items():
        if not name.endswith('.rels'): continue
        entries={}; parent=posixpath.dirname(posixpath.dirname(name))
        for node in tree:
            assert node.get('Id') not in entries and not node.get('TargetMode')
            target=posixpath.normpath(posixpath.join(parent,node.get('Target'))).lstrip('/');assert target in files
            entries[node.get('Id')]=target
        relations[name]=entries
    for name,bytes_ in files.items():
        if name.endswith('.png'):
            image=Image.open(io.BytesIO(bytes_));assert image.format=='PNG';image.verify()
    for index,scene in enumerate(scenes,1):
        name=f'ppt/slides/slide{index}.xml';tree=trees[name];shapes=list(tree.find('p:cSld/p:spTree',NS))[2:]
        converted=conversion['slides'][index-1];assert converted['slideId']==scene['slideId']
        assert converted['nativeIndexConvention']=='one-based-slide-shape-order' and converted['rasterizedObjects']==[]
        source=converted['sourceDocument'];assert digest((base/source['path']).read_bytes())==source['sha256']
        assert len(converted['objects'])==len(scene['objects'])
        assert len(shapes)==len(scene['objects'])
        for native_index,(obj,shape,mapping) in enumerate(zip(scene['objects'],shapes,converted['objects']),1):
            assert shape.find('.//p:cNvPr',NS).get('name')==obj['id']
            assert mapping['nativeIndex']==native_index and mapping['sourceId']==obj['id'] and mapping['nativeKind']==obj['kind'] and mapping['verified']
            assert mapping['nativeShapeId']==shape.find('.//p:cNvPr',NS).get('id')
            assert all(mapping['bounds'][key]==obj[key] for key in ['x','y','w','h'])
            transform=shape.find('p:spPr/a:xfrm',NS);off=transform.find('a:off',NS);ext=transform.find('a:ext',NS)
            for value,actual in zip([obj['x'],obj['y'],obj['w'],obj['h']],[off.get('x'),off.get('y'),ext.get('cx'),ext.get('cy')]):assert abs(float(actual)/9525-value)<.01
            if obj['kind']=='text':
                paragraphs=shape.findall('p:txBody/a:p',NS)
                assert '\n'.join(''.join(p.itertext()) for p in paragraphs)==obj['text']
                for paragraph in paragraphs:
                    properties=paragraph.findall('a:pPr',NS);assert len(properties)<=1 and (not properties or list(paragraph)[0] is properties[0]),'Repeated/misordered paragraph properties'
                runs=shape.findall('.//a:r',NS); assert all(run.find('a:rPr/a:latin',NS).get('typeface')=='Arial' for run in runs)
            elif obj['kind']=='rect':assert shape.find('p:spPr/a:solidFill/a:srgbClr',NS).get('val')==obj['fill']
            else:
                links=relations[f'ppt/slides/_rels/slide{index}.xml.rels'];picture=shape.find('.//a:blip',NS);part=links[picture.get('{'+R+'}embed')]
                assert files[part].startswith(b'\x89PNG\r\n\x1a\n')
                if obj['mediaType']=='image/svg+xml':
                    svg=next(node for node in shape.iter() if node.tag.endswith('}svgBlip'));part=links[svg.get('{'+R+'}embed')];assert digest(files[part])==obj['sha256']
    pdf=PdfReader(outputs['pdf']['file']);assert len(pdf.pages)==len(scenes);assert 'Кириллица' in pdf.pages[0].extract_text()
    report={'status':'passed','slides':len(scenes),'independentParsers':['ElementTree','zipfile','Pillow','pypdf'],'office':False,'visibleNoRepairObservation':False}
    if office:
        evidence=json.loads((result_file.parent/'powerpoint/verification.json').read_text(encoding='utf-8-sig'));assert evidence['editReopen']=={'text':True,'shape':True}
        assert evidence['actualEditedText']=='Правка — сохранено'
        with zipfile.ZipFile(result_file.parent/'powerpoint/edited.pptx') as edited:
            assert edited.testzip() is None
            tree=ET.fromstring(edited.read('ppt/slides/slide1.xml'));title=next(shape for shape in tree.findall('p:cSld/p:spTree/p:sp',NS) if shape.find('p:nvSpPr/p:cNvPr',NS).get('name')=='title')
            assert ''.join(node.text or '' for node in title.findall('.//a:t',NS))=='Правка — сохранено'
            expected_grid=[(i,s['slideId']) for i,s in enumerate(scenes,1) if s['conversion']['containers']]
            assert [(e['slideIndex'],e['slideId']) for e in evidence['gridEditReopen']]==expected_grid
            for entry in evidence['gridEditReopen']:
                tree=ET.fromstring(edited.read(f"ppt/slides/slide{entry['slideIndex']}.xml"))
                named={s.find('p:nvSpPr/p:cNvPr',NS).get('name'):s for s in tree.findall('p:cSld/p:spTree/p:sp',NS)}
                assert ''.join(n.text or '' for n in named[entry['textShape']].findall('.//a:t',NS))=='Правка — сохранено'
                assert named[entry['fillShape']].find('p:spPr/a:solidFill/a:srgbClr',NS).get('val')=='22CC66'
        assert evidence['widthPt']==720 and evidence['heightPt']==405
        assert evidence['source']==outputs['pptx']['file']
        for scene,slide in zip(scenes,evidence['slides']):
            assert [obj['id'] for obj in scene['objects']]==[s['name'] for s in sorted(slide['shapes'],key=lambda s:s['zOrder'])]
            for obj,shape in zip(scene['objects'],slide['shapes']):
                for key,source in [('left','x'),('top','y'),('width','w'),('height','h')]: assert abs(shape[key]/.75-obj[source])<.1
                if obj['kind']=='text':
                    assert shape['type'] in (1,17) and shape['text'].replace('\r','\n')==obj['text']
                    assert [line.replace('\r','') for line in shape['lines']]==obj['lines'],(obj['id'],shape['lines'],obj['lines'])
                    expected=[(char,run['bold'],run['italic'],run['underline'],run['size']*.75) for run in obj['runs'] for char in run['text'] if char!='\n']
                    actual=[(char,run['bold']==-1,run['italic']==-1,run['underline']==-1,run['size']) for run in shape['runs'] for char in run['text'] if char!='\r']
                    assert actual==expected,(obj['id'],'Office run formatting changed')
                    assert all(run['font']=='Arial' for run in shape['runs'] if run['text'].replace('\r',''))
                    bounds=shape['textBounds'];assert bounds['left']>=shape['left']-3 and bounds['top']>=shape['top']-3 and bounds['left']+bounds['width']<=shape['left']+shape['width']+3 and bounds['top']+bounds['height']<=shape['top']+shape['height']+3
                elif obj['kind']=='rect':assert shape['type']==1
                else:assert shape['type'] in (13,28)
        report.update(office=True,powerpointVersion=evidence['version'],nativeTextAndShapeEdits=True,exactLineBreaks=True)
    (result_file.parent/'independent-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
if __name__=='__main__':check(Path(sys.argv[1]),'--office' in sys.argv)
