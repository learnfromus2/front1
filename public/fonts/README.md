# Gujarati Font Setup

## Font File Required

Place the `EKLG-13-BoldItalic.ttf` font file in this directory.

## Font Information

- **Font Name**: EKLG-13-BoldItalic
- **Purpose**: Rendering Gujarati text in questions, options, and solutions
- **Format**: TrueType Font (.ttf)

## Usage

The font is automatically applied to:
- Questions with `language: 'gu'` in the database
- Elements with class `lang-gu` or `gujarati-text`
- Elements with attribute `lang="gu"`

## Fallback

If the EKLG font is not available, the system will fall back to:
1. Noto Sans Gujarati (Google Fonts)
2. System sans-serif font

## Adding the Font File

1. Obtain the `EKLG-13-BoldItalic.ttf` font file
2. Place it in this directory (`public/fonts/`)
3. The CSS file (`gujarati-font.css`) will automatically load it

## Testing

To test if the font is working:
1. Add a question with `language: 'gu'` in the database
2. View the question in the Question Bank
3. The text should render in the EKLG-13-BoldItalic font
