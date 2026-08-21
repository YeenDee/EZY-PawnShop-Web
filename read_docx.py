import zipfile
import xml.etree.ElementTree as ET
import os

docx_path = r"d:\EZY-PawnShop-Web\EZY Pawnshop2006 Web -Spec.docx"
output_path = r"d:\EZY-PawnShop-Web\spec_text.txt"

def docx_to_text(docx_file, txt_file):
    try:
        with zipfile.ZipFile(docx_file) as docx:
            xml_content = docx.read('word/document.xml')
            root = ET.fromstring(xml_content)
            
            # XML namespaces
            ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            
            text_lines = []
            # Find all paragraphs
            for paragraph in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'):
                p_text = []
                for run in paragraph.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'):
                    if run.text:
                        p_text.append(run.text)
                text_lines.append("".join(p_text))
            
            with open(txt_file, 'w', encoding='utf-8') as f:
                f.write("\n".join(text_lines))
            print("Successfully extracted docx to txt")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == '__main__':
    docx_to_text(docx_path, output_path)
