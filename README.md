![Markbook ](https://socialify.git.ci/harivarshney/markbook/image?font=Jost&language=1&name=1&owner=1&pattern=Circuit+Board&stargazers=1&theme=Dark)

# 📚 Markbook — AI Assessment Extraction & Grading

### Turn a question paper and handwritten answer sheet into a structured, reviewable assessment — with AI-powered question extraction, answer mapping, precise highlighting, and grading.

---

## 💡 The Idea

Traditional assessment starts with a teacher manually going through an entire answer sheet:

**Find the question → find the answer → check the answer → assign marks → repeat.**

This becomes especially tedious when students:

* Answer questions out of order
* Write answers across multiple pages
* Leave questions unanswered
* Use handwritten responses that are difficult to search or organize
* Include labelled sub-parts such as `11 (a)` and `11 (b)`

**Markbook is built to solve that workflow.**

A teacher uploads two files:

1. A question paper
2. A student's handwritten answer sheet

Markbook uses AI to understand both documents, extract their structure, identify which handwritten answer belongs to which question, locate the exact answer on the page, and provide an AI-assisted grading result.

The goal is simple:

> **A teacher should be able to click any question and immediately see exactly where the student's answer is, what they wrote, and how it was evaluated.**

---

## ✨ What Markbook Actually Does

| Capability                      | What happens                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| 📄 **Question Extraction**      | Extracts every question from the uploaded question paper while preserving the original numbering |
| 🔢 **Sub-question Detection**   | Treats labelled parts such as `11 (a)` and `11 (b)` as separate questions                        |
| ✍️ **Handwriting Extraction**   | Detects handwritten answer regions from every answer-sheet page                                  |
| 🏷️ **Question Identification** | Detects the question number written by the student whenever it is legible                        |
| 🔗 **Answer Mapping**           | Maps extracted answers to their corresponding questions                                          |
| 📑 **Multi-page Answers**       | Groups answer segments when a response continues across multiple pages                           |
| ❌ **Unanswered Detection**      | Identifies questions for which no answer was found                                               |
| ⚠️ **Unmatched Answers**        | Flags answer regions that cannot confidently be associated with a question                       |
| 🎯 **Precise Highlighting**     | Highlights the exact region of the handwritten answer on the original page                       |
| 🧠 **AI Grading**               | Generates marks and concise feedback for answered questions                                      |
| 📊 **Assessment Summary**       | Gives the teacher a structured overview of the assessment                                        |
| ⚡ **Live Processing**           | Shows actual pipeline progress while the documents are being processed                           |

---

## 🔄 The Processing Pipeline

Markbook is not simply an OCR wrapper.

The application uses multiple AI stages, each responsible for a different part of the assessment workflow.

```text
                  ┌─────────────────────────┐
                  │      Teacher Uploads    │
                  │                         │
                  │   Question Paper        │
                  │   Answer Sheet          │
                  └────────────┬────────────┘
                               │
                 ┌─────────────▼─────────────┐
                 │       File Processing      │
                 │                            │
                 │ PDF / Image Validation     │
                 │ PDF → Page Images          │
                 └─────────────┬─────────────┘
                               │
             ┌─────────────────┴─────────────────┐
             │                                   │
             ▼                                   ▼
   ┌────────────────────┐             ┌────────────────────┐
   │ Question Extraction │             │  Answer Extraction │
   │                     │             │                    │
   │ Gemini              │             │ Gemini             │
   │ Full paper context  │             │ Page-by-page       │
   └──────────┬─────────┘             └──────────┬─────────┘
              │                                  │
              │                                  │
              └──────────────┬───────────────────┘
                             ▼
                 ┌────────────────────────┐
                 │    Answer Mapping      │
                 │                        │
                 │ Question label first  │
                 │ Content matching      │
                 │ Multi-page grouping   │
                 └────────────┬───────────┘
                              │
                              ▼
                 ┌────────────────────────┐
                 │      AI Grading        │
                 │                        │
                 │ Score + Feedback       │
                 │ Unanswered detection  │
                 │ Unmatched detection   │
                 └────────────┬───────────┘
                              │
                              ▼
                 ┌────────────────────────┐
                 │     Review Interface   │
                 │                        │
                 │ Questions   Answer     │
                 │    List    + Highlight │
                 └────────────────────────┘
```

---

## 🧠 How the AI Pipeline Works

### 1. Question Paper Extraction

All pages of the question paper are provided to Gemini together.

This is intentional.

Giving the complete question paper context allows the model to reason about:

* Question numbering
* Continuation across pages
* Section boundaries
* Labelled sub-parts
* The relationship between questions and their descriptions

For example:

```text
11. Answer the following:

11 (a) Explain the concept of...
11 (b) Compare the following...
```

is represented as two independent assessment items while preserving the original labels.

```text
11 (a)
11 (b)
```

---

### 2. Answer Sheet Extraction

The handwritten answer sheet is processed **page by page**.

For every detected handwritten answer region, Gemini returns structured information including:

```text
{
  questionLabel,
  transcription,
  boundingBox
}
```

The page-level processing is important because every bounding box remains unambiguous relative to a single source image.

The system can therefore determine not only:

> "The student answered question 4."

but also:

> "The answer to question 4 is located here on page 3."

---

### 3. Answer Mapping

The extracted questions and answer regions are then passed into a dedicated mapping stage.

Markbook attempts to associate answers using:

```text
1. Detected question label
        ↓
2. Content/context matching
        ↓
3. Multi-page answer grouping
```

This allows the system to handle cases where the student does not follow the printed order of the question paper.

For example:

```text
Question Paper

1
2
3
4
5


Student Answer Sheet

4
1
5
3
2
```

Markbook maps them back to:

```text
Question 1 → Answer region
Question 2 → Answer region
Question 3 → Answer region
Question 4 → Answer region
Question 5 → Answer region
```

rather than assuming that answer position equals question position.

---

## 🎯 Precise Answer Highlighting

One of the most important parts of Markbook is that it does not stop after extracting text.

Each handwritten region is associated with a bounding box.

When a teacher selects a question, Markbook:

```text
Question selected
       ↓
Find mapped answer
       ↓
Identify answer-sheet page
       ↓
Render original page
       ↓
Apply bounding-box overlay
       ↓
Highlight the student's answer
```

The highlight uses percentage-based positioning, allowing the overlay to remain aligned with the original answer region even when the page is displayed at different screen sizes.

This makes the mapping **visually verifiable** instead of relying only on AI-generated text.

---

## 📊 AI-Assisted Grading

After the question-answer mapping is complete, Markbook can evaluate answered questions.

For each mapped answer, the system can provide:

```text
Question
    ↓
Student Answer
    ↓
AI Evaluation
    ↓
Marks / Score
    ↓
Short Feedback
```

The grading output is intended to assist teachers with first-pass assessment rather than replace human judgment.

The teacher can therefore use Markbook to quickly identify:

* Strong answers
* Weak answers
* Unanswered questions
* Potentially incorrect responses
* Areas requiring manual review

---

## ⚡ Real Processing Progress

The progress indicator is not a simulated animation.

Markbook streams processing-state updates from the server as the actual pipeline moves through its stages.

A typical workflow looks like:

```text
Uploading files
      ↓
Rendering pages
      ↓
Extracting questions
      ↓
Extracting handwritten answers
      ↓
Mapping answers
      ↓
Grading responses
      ↓
Preparing assessment
      ↓
Ready for review
```

This provides feedback to the teacher while the AI pipeline is running instead of leaving them staring at a static loading screen.

---

## 🏗️ Architecture

```text
                    ┌─────────────────────────────┐
                    │        Next.js Frontend      │
                    │                             │
                    │  Upload Interface            │
                    │  Processing Progress         │
                    │  Question List               │
                    │  Answer Viewer               │
                    │  Highlight Overlay           │
                    │  Grading Summary             │
                    └──────────────┬──────────────┘
                                   │
                                   │ API
                                   ▼
                    ┌─────────────────────────────┐
                    │       Next.js Server         │
                    │                             │
                    │  File Processing             │
                    │  PDF Rendering               │
                    │  AI Pipeline                 │
                    │  Result Transformation       │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
                    ▼                             ▼
          ┌──────────────────┐          ┌──────────────────┐
          │   PDF Renderer   │          │   Gemini 2.5     │
          │                  │          │      Flash       │
          │ pdfjs-dist       │          │                  │
          │ @napi-rs/canvas  │          │ Extraction       │
          └──────────────────┘          │ Mapping          │
                                        │ Grading          │
                                        └──────────────────┘
```

---

## 🛠️ Tech Stack

### Frontend & Application

* **Next.js** — App Router
* **TypeScript**
* **Tailwind CSS**

### AI

* **Google Gemini 2.5 Flash**
* `@google/genai`

Gemini is used for:

* Question extraction
* Handwritten answer extraction
* Answer mapping
* Multi-page answer grouping
* Grading
* Feedback generation

### Document Processing

* **pdfjs-dist** — PDF processing
* **@napi-rs/canvas** — server-side PDF page rendering

PDF pages are converted into images server-side before being passed through the AI extraction pipeline.

This avoids depending on a headless browser or system-level Cairo installation and makes the rendering approach suitable for serverless deployment.

### Storage

No database is required.

Markbook processes the assessment in memory and keeps the resulting assessment state on the client for the review workflow.

---

## 🚀 Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/harivarshney/markbook.git
cd markbook
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a local environment file:

```bash
cp .env.example .env.local
```

Add your Gemini API key:

```env
GEMINI_API_KEY=your_api_key_here
```

You can create a Gemini API key through Google AI Studio.

### 4. Start the development server

```bash
npm run dev
```

The application will be available at:

```text
http://localhost:3000
```

---

## 🌐 Live Demo

**Markbook:**
https://markbook-rho.vercel.app

---

## 📁 Project Structure

```text
markbook/
├── app/
│   ├── api/
│   │   └── ...
│   ├── ...
│   └── page.tsx
│
├── components/
│   ├── ...
│   └── ...
│
├── lib/
│   ├── ...
│   └── ...
│
├── public/
│
├── OVERVIEW.md
├── README.md
├── next.config.ts
├── package.json
├── tsconfig.json
└── LICENSE
```

The application is organized around three major responsibilities:

```text
UI
 ↓
Document / Assessment Processing
 ↓
AI Extraction + Mapping + Grading
```

---

## 🔁 How an Assessment Actually Runs

```text
Teacher uploads question paper + answer sheet

        ↓

Files are validated

        ↓

PDFs are rendered into individual page images

        ↓

Question paper pages
        → Gemini
        → Structured questions

Answer sheet pages
        → Gemini
        → Handwritten regions + transcription + labels

        ↓

Mapping stage

        → Match detected labels
        → Compare answer content
        → Group multi-page answers

        ↓

Assessment stage

        → Detect unanswered questions
        → Detect unmatched answers
        → Generate marks
        → Generate feedback

        ↓

Review interface

        → Select question
        → Locate answer
        → Render correct page
        → Highlight exact answer region
```

---

## 🧩 Important Engineering Decisions

### Why process the question paper together?

Question papers contain context that can span pages.

Processing the complete paper together allows the model to understand the document's overall numbering structure and prevents page boundaries from incorrectly separating related questions.

---

### Why process answer sheets page-by-page?

Bounding boxes are inherently page-relative.

Processing each answer-sheet page independently means every returned coordinate belongs to exactly one image, making subsequent highlighting predictable and reliable.

---

### Why separate extraction and mapping?

Extraction and mapping are different problems.

The extraction stage answers:

> **"What is on this page?"**

The mapping stage answers:

> **"Which question does this answer belong to?"**

Keeping these responsibilities separate makes the pipeline easier to reason about and allows the mapping logic to handle out-of-order answers and multi-page responses.

---

### Why use percentage-based coordinates?

The answer sheet may be displayed at different sizes depending on the device and viewport.

Instead of storing only fixed pixel coordinates, the UI uses percentage-based positioning for the highlight overlay.

Conceptually:

```text
x = boundingBox.x / imageWidth
y = boundingBox.y / imageHeight

width  = boundingBox.width  / imageWidth
height = boundingBox.height / imageHeight
```

This keeps the highlight aligned with the original handwritten region when the image is resized.

---

## 🎯 Edge Cases Handled

Markbook is designed around the fact that real student answer sheets are not perfectly structured.

### Out-of-order answers

```text
Question Paper: 1 → 2 → 3 → 4

Answer Sheet:   3 → 1 → 4 → 2
```

Answers are mapped by identity rather than physical position.

### Unanswered questions

If a question has no corresponding answer region, it is retained in the assessment and marked as unanswered.

### Unmatched answers

If an answer region cannot confidently be associated with a question, it can be flagged rather than silently assigned to the wrong question.

### Labelled sub-parts

```text
11 (a)
11 (b)
```

are treated as separate assessment entries.

### Multi-page answers

If a response continues onto another page, the corresponding answer regions can be grouped together so the teacher can review the complete response.

---

## ⚠️ Known Limitations

Being transparent about the current limitations is important because this system operates on real-world handwritten documents.

### Handwriting quality

Bounding-box accuracy depends on scan/photo quality.

Very faint, distorted, crowded, or messy handwriting can result in less precise regions.

### AI grading

The grading system is AI-assisted.

It should be treated as a **first-pass assessment aid**, not an authoritative replacement for teacher evaluation.

### Document limits

For serverless reliability, PDFs are currently limited to:

* **30 pages per file**
* **20 MB per file**

### No persistent assessment database

Markbook currently does not require authentication or a database.

Assessment state is maintained for the active workflow rather than being stored as a permanent academic record.

### Model dependency

Extraction, mapping, and grading quality depend partly on the vision and reasoning capabilities of the selected Gemini model.

---

## 🔐 Privacy & Data Handling

Markbook is designed as a lightweight assessment-processing application.

There is currently:

* No authentication
* No persistent assessment database
* No student account system
* No long-term assessment history

Uploaded assessment files are processed as part of the active workflow.

For production use in educational environments, additional privacy, access-control, retention, and data-governance mechanisms would be required.

---

## 🧪 Future Improvements

Potential directions for Markbook include:

* [ ] Teacher authentication and assessment history
* [ ] Persistent database-backed assessments
* [ ] Batch processing for multiple students
* [ ] Class-level dashboards
* [ ] Export graded assessments as PDF
* [ ] Teacher correction / mark override
* [ ] More advanced handwriting recognition
* [ ] Confidence scores for question-answer mappings
* [ ] Manual correction of incorrect mappings
* [ ] Rubric-based grading
* [ ] Custom marking schemes
* [ ] Question-wise performance analytics
* [ ] Support for more complex mathematical notation
* [ ] Improved handling of diagrams and handwritten equations

---

## 🏁 The Goal

Markbook is built around one simple idea:

> **Assessment software should help a teacher spend less time searching through answer sheets and more time actually evaluating students.**

Instead of manually searching for every answer:

```text
Question
   ↓
Where is the answer?
   ↓
Find the page
   ↓
Find the handwritten region
   ↓
Read the response
   ↓
Evaluate
```

Markbook turns that into:

```text
Click Question
      ↓
Answer Found
      ↓
Exact Region Highlighted
      ↓
AI-Assisted Evaluation
```

The teacher remains in control.

The AI handles the repetitive document understanding and organization work.

---

## 📌 Assignment Context

Markbook was originally developed as an implementation of the **AI Assessment Extraction & Answer Mapping** assignment.

The original requirements included:

* Question paper extraction
* Handwritten answer extraction
* Question-answer mapping
* Exact answer-region highlighting
* Out-of-order answers
* Unanswered questions
* Unmatched answers
* Multi-page answers
* Optional AI grading and feedback

The implementation extends that core workflow into a complete AI-assisted assessment experience.

---

## 📄 License

MIT License — see [`LICENSE`](LICENSE).

---

## 👨‍💻 Author

**Hari Varshney**

AI/ML Developer & B.Tech AI & ML Student

* Live Demo: https://markbook-rho.vercel.app

---

⭐ If you found Markbook interesting, consider giving the repository a star.
