
import mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } from 'docx';
import saveAs from 'file-saver';

export const extractTextFromDocx = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
};

export const downloadAsDocx = async (text: string, filename: string) => {
  // Simple parser to handle basic structure (lines starting with # or bullets)
  const lines = text.split('\n');
  const children = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return new Paragraph({ spacing: { before: 100, after: 100 } });

    // Header detection
    if (trimmed.startsWith('#') || (trimmed.toUpperCase() === trimmed && trimmed.length < 30)) {
      return new Paragraph({
        text: trimmed.replace(/^#+\s*/, ''),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      });
    }

    // Bullet point detection
    if (trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*')) {
      return new Paragraph({
        children: [new TextRun(trimmed.replace(/^[-•*]\s*/, ''))],
        bullet: { level: 0 },
        spacing: { before: 50, after: 50 },
      });
    }

    // Default paragraph
    return new Paragraph({
      children: [new TextRun(trimmed)],
      spacing: { before: 80, after: 80 },
    });
  });

  const doc = new Document({
    sections: [{
      properties: {},
      children: children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${filename}.docx`);
};
