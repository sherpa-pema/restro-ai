export const API_KEY = 'K87657601888957';
export const API_URL = 'https://api.ocr.space/parse/image';

export const analyzeImage = async (file) => {
  const formData = new FormData();
  formData.append('file', file, file.name);
  formData.append('apikey', API_KEY);
  formData.append('isTable', 'true');
  formData.append('OCREngine', '2'); // Engine 2 is often better for receipts/tables

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Raw OCR Response:", data);

    if (data.IsErroredOnProcessing) {
      throw new Error(data.ErrorMessage?.[0] || 'OCR processing failed');
    }

    // Process parsed text and attempt to format into table rows
    const parsedText = data.ParsedResults?.[0]?.ParsedText || '';
    
    return parseTextToTable(parsedText);
  } catch (error) {
    console.error('Error during OCR analysis:', error);
    throw error;
  }
};

/**
 * Basic heuristic-based parser to try and extract Menu items from raw OCR text.
 * Without an LLM, this relies on finding patterns that look like prices.
 */
function parseTextToTable(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const results = [];
  
  let currentCategory = 'General';

  // Basic regex to find a price (e.g., $10.99, 10.99, £5, 120)
  const priceRegex = /(?:[\$£€]\s*)?\d+(?:\.\d{2})?\b/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Heuristic for Category: short lines without numbers usually act as headers
    if (line.length < 20 && !/\d/.test(line)) {
        // Just a guess that this might be a category header if it's short and text-only
        currentCategory = line;
        continue;
    }

    // Try to find a price in the line
    const priceMatch = line.match(priceRegex);
    
    if (priceMatch && priceMatch.length > 0) {
      // The price is usually the last number in the line
      let rateStr = priceMatch[priceMatch.length - 1];
      
      // Remove the rate from the line to get the name/description
      let nameStr = line.replace(rateStr, '').trim();
      
      // Clean up trailing/leading junk like dots often found in menus (e.g. Item Name ....... $10)
      nameStr = nameStr.replace(/[\.\-_]+$/, '').trim();

      // Ensure rate is a clean number (strip currency symbols)
      const cleanRate = rateStr.replace(/[^\d.]/g, '');

      results.push({
        id: crypto.randomUUID(),
        category: currentCategory,
        name: nameStr || 'Unknown Item',
        description: '', // N/A
        rate: cleanRate
      });
    } else {
      // Line with no price could be a description for the PREVIOUS item, or just stray text.
      if (results.length > 0 && results[results.length - 1].description === '') {
        results[results.length - 1].description = line;
      }
    }
  }

  if (results.length === 0 && text.length > 0) {
      results.push({
          id: crypto.randomUUID(),
          category: 'Unparsed Text',
          name: 'Raw OCR Output',
          description: text.substring(0, 100) + '...',
          rate: '0'
      });
  }

  return results;
}
