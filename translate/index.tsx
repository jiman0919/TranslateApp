import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI } from "@google/genai";
import { 
  Camera, 
  Image as ImageIcon, 
  Type, 
  History, 
  BookOpen, 
  ChevronRight, 
  Loader2, 
  Upload, 
  X,
  Languages,
  Save,
  ArrowRightLeft
} from "lucide-react";

/**
 * ==================================================================================
 * BACKEND / SERVICE LAYER
 * ==================================================================================
 */

// --- CONFIGURATION ---
const LANG_OPTIONS = [
  { code: "en", label: "English" },
  { code: "ko", label: "한국어" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
];

const SYSTEM_PROMPT = "You are a professional translator. Translate the input accurately. Only return the translated text, no explanations.";

// --- GEMINI API SERVICE ---
class GeminiService {
  private client: GoogleGenAI;
  private modelName = 'gemini-2.5-flash';

  constructor() {
    this.client = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || "" });
  }

  async translateText(text: string, sourceLang: string, targetLang: string): Promise<string> {
    if (!text.trim()) return "";
    try {
      const prompt = `Translate the following text from ${sourceLang} to ${targetLang}. Text: "${text}"`;
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: { systemInstruction: SYSTEM_PROMPT }
      });
      return response.text || "Translation failed.";
    } catch (error) {
      console.error("Translation Error:", error);
      return "Error: Could not translate text.";
    }
  }

  async translateImage(base64Image: string, sourceLang: string, targetLang: string): Promise<string> {
    try {
      const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");
      
      const prompt = `Translate all visible text in this image from ${sourceLang} to ${targetLang}. Return ONLY the translated text. If there is no text, say "No text found".`;
      
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: {
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } },
            { text: prompt }
          ]
        }
      });
      return response.text || "Analysis failed.";
    } catch (error) {
      console.error("Image Translation Error:", error);
      return "Error: Could not analyze image.";
    }
  }
}

// --- DATA TYPES ---
interface TranslationRecord {
  id: string;
  type: 'text' | 'image' | 'camera';
  original: string; // Text content or Base64 Image
  translated: string;
  sourceLang: string;
  targetLang: string;
  timestamp: number;
}

// --- STORAGE SERVICE (GOOGLE SHEETS VIA APPS SCRIPT) ---
class StorageService {
  private SHEET_URL = import.meta.env.VITE_GOOGLE_SHEET_URL || "";

  async saveRecord(record: Omit<TranslationRecord, 'id' | 'timestamp'>): Promise<TranslationRecord> {
    const newRecord: TranslationRecord = {
      ...record,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };

    if (!this.SHEET_URL) {
      console.warn("GOOGLE_SHEET_URL is missing in .env");
      return newRecord;
    }

    try {
      // Google Apps Script Web Apps often require 'no-cors' or specific text/plain headers 
      // to avoid CORS preflight issues on simple POST requests.
      await fetch(this.SHEET_URL, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8", 
        },
        body: JSON.stringify({ action: "save", data: newRecord }),
      });
    } catch (error) {
      console.error("Failed to save to Google Sheet:", error);
    }

    return newRecord;
  }

  async getRecords(): Promise<TranslationRecord[]> {
    if (!this.SHEET_URL) return [];

    try {
      const response = await fetch(this.SHEET_URL);
      if (!response.ok) throw new Error("Network response was not ok");
      
      const json = await response.json();
      return json.data || [];
    } catch (error) {
      console.error("Failed to fetch records:", error);
      return [];
    }
  }
}

// Instantiate Services
const aiService = new GeminiService();
const storageService = new StorageService();

/**
 * ==================================================================================
 * FRONTEND / UI LAYER
 * ==================================================================================
 */

// --- COMPONENTS ---

const Header = ({ title }: { title: string }) => (
  <header className="bg-indigo-600 text-white p-4 shadow-md sticky top-0 z-10">
    <h1 className="text-xl font-bold flex items-center gap-2">
      <Languages className="w-6 h-6" />
      {title}
    </h1>
  </header>
);

const LanguagePairSelector = ({ 
  source, 
  target, 
  onSourceChange, 
  onTargetChange 
}: { 
  source: string, 
  target: string, 
  onSourceChange: (v: string) => void, 
  onTargetChange: (v: string) => void 
}) => (
  <div className="flex items-end gap-2 mb-4 bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
    <div className="flex-1">
      <label className="block text-xs font-semibold text-gray-500 mb-1">From</label>
      <select 
        value={source} 
        onChange={(e) => onSourceChange(e.target.value)}
        className="block w-full rounded-lg border-gray-300 bg-gray-50 p-2 text-sm focus:border-indigo-500 focus:ring-indigo-500 border"
      >
        {LANG_OPTIONS.map(opt => (
          <option key={`src-${opt.code}`} value={opt.label}>{opt.label}</option>
        ))}
      </select>
    </div>

    <div className="pb-2 text-gray-400">
      <ArrowRightLeft size={20} />
    </div>

    <div className="flex-1">
      <label className="block text-xs font-semibold text-gray-500 mb-1">To</label>
      <select 
        value={target} 
        onChange={(e) => onTargetChange(e.target.value)}
        className="block w-full rounded-lg border-gray-300 bg-indigo-50 p-2 text-sm focus:border-indigo-500 focus:ring-indigo-500 border"
      >
        {LANG_OPTIONS.map(opt => (
          <option key={`tgt-${opt.code}`} value={opt.label}>{opt.label}</option>
        ))}
      </select>
    </div>
  </div>
);

// 1. TEXT TRANSLATOR TAB
const TextTranslator = () => {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [sourceLang, setSourceLang] = useState(LANG_OPTIONS[0].label); // Default English
  const [targetLang, setTargetLang] = useState(LANG_OPTIONS[1].label); // Default Korean
  const [loading, setLoading] = useState(false);

  const handleTranslate = async () => {
    if (!input) return;
    setLoading(true);
    const result = await aiService.translateText(input, sourceLang, targetLang);
    setOutput(result);
    
    // Save to history (Fire and forget or await)
    await storageService.saveRecord({
      type: 'text',
      original: input,
      translated: result,
      sourceLang,
      targetLang
    });
    
    setLoading(false);
  };

  return (
    <div className="p-4 flex flex-col h-full space-y-4">
      <LanguagePairSelector 
        source={sourceLang} 
        target={targetLang} 
        onSourceChange={setSourceLang} 
        onTargetChange={setTargetLang} 
      />
      
      <textarea
        className="flex-1 w-full p-4 rounded-xl border border-gray-200 shadow-sm focus:ring-2 focus:ring-indigo-500 resize-none"
        placeholder={`Enter ${sourceLang} text...`}
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      
      <div className="flex justify-center">
        <button 
          onClick={handleTranslate}
          disabled={loading || !input}
          className="bg-indigo-600 text-white px-8 py-3 rounded-full font-semibold shadow-lg active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? <Loader2 className="animate-spin" /> : "Translate"}
        </button>
      </div>

      <div className="flex-1 bg-white p-4 rounded-xl border border-gray-200 shadow-sm min-h-[150px]">
        <h3 className="text-xs font-bold text-gray-400 uppercase mb-2">Result ({targetLang})</h3>
        <p className="text-gray-800 text-lg">{output}</p>
      </div>
    </div>
  );
};

// 2. IMAGE UPLOAD TRANSLATOR TAB
const ImageTranslator = ({ mode }: { mode: 'upload' | 'camera' }) => {
  const [image, setImage] = useState<string | null>(null);
  const [output, setOutput] = useState("");
  const [sourceLang, setSourceLang] = useState(LANG_OPTIONS[0].label);
  const [targetLang, setTargetLang] = useState(LANG_OPTIONS[1].label);
  const [loading, setLoading] = useState(false);
  
  // Camera refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);

  // File Upload Handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setImage(reader.result as string);
      reader.readAsDataURL(file);
      setOutput("");
    }
  };

  // Camera Handler
  const startCamera = async () => {
    setIsCameraActive(true);
    setImage(null);
    setOutput("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      alert("Cannot access camera. Please allow permissions.");
      setIsCameraActive(false);
    }
  };

  const captureImage = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        const dataUrl = canvasRef.current.toDataURL('image/jpeg');
        setImage(dataUrl);
        setIsCameraActive(false);
        
        // Stop stream
        const stream = videoRef.current.srcObject as MediaStream;
        stream?.getTracks().forEach(t => t.stop());
      }
    }
  };

  const handleTranslate = async () => {
    if (!image) return;
    setLoading(true);
    const result = await aiService.translateImage(image, sourceLang, targetLang);
    setOutput(result);

    // Save to history
    await storageService.saveRecord({
      type: mode === 'upload' ? 'image' : 'camera',
      original: image,
      translated: result,
      sourceLang,
      targetLang
    });
    
    setLoading(false);
  };

  useEffect(() => {
    if (mode === 'camera') startCamera();
    return () => {
      // Cleanup camera on unmount
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [mode]);

  return (
    <div className="p-4 flex flex-col h-full space-y-4 overflow-y-auto">
      <LanguagePairSelector 
        source={sourceLang} 
        target={targetLang} 
        onSourceChange={setSourceLang} 
        onTargetChange={setTargetLang} 
      />

      {/* Preview / Capture Area */}
      <div className="relative w-full aspect-[4/3] bg-gray-200 rounded-xl overflow-hidden shadow-inner flex items-center justify-center">
        {mode === 'camera' && isCameraActive ? (
          <>
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <button 
              onClick={captureImage}
              className="absolute bottom-4 bg-white rounded-full p-4 shadow-xl active:scale-95"
            >
              <div className="w-8 h-8 rounded-full border-4 border-indigo-600 bg-transparent"></div>
            </button>
          </>
        ) : image ? (
          <>
            <img src={image} alt="Preview" className="w-full h-full object-contain bg-black" />
            <button 
              onClick={() => { setImage(null); if(mode==='camera') startCamera(); }}
              className="absolute top-2 right-2 bg-black/50 text-white p-2 rounded-full"
            >
              <X size={20} />
            </button>
          </>
        ) : (
          <div className="text-center p-6">
            {mode === 'upload' ? (
              <label className="cursor-pointer flex flex-col items-center gap-2 text-indigo-600">
                <Upload size={48} />
                <span className="font-semibold">Tap to Upload Photo</span>
                <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
              </label>
            ) : (
              <button onClick={startCamera} className="flex flex-col items-center gap-2 text-indigo-600">
                <Camera size={48} />
                <span className="font-semibold">Tap to Start Camera</span>
              </button>
            )}
          </div>
        )}
      </div>
      
      {/* Hidden Canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Action Button */}
      {image && !loading && (
        <button 
          onClick={handleTranslate}
          className="bg-indigo-600 text-white w-full py-3 rounded-xl font-semibold shadow-lg"
        >
          Analyze & Translate
        </button>
      )}

      {loading && (
        <div className="bg-white p-6 rounded-xl shadow-sm text-center">
          <Loader2 className="animate-spin mx-auto text-indigo-600 mb-2" />
          <p className="text-gray-500 text-sm">Processing image with Gemini AI...</p>
        </div>
      )}

      {/* Result */}
      {output && (
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
           <h3 className="text-xs font-bold text-gray-400 uppercase mb-2">Translation ({sourceLang} → {targetLang})</h3>
           <p className="text-gray-800 text-lg whitespace-pre-wrap">{output}</p>
        </div>
      )}
    </div>
  );
};

// 3. HISTORY TAB
const HistoryView = () => {
  const [records, setRecords] = useState<TranslationRecord[]>([]);
  const [selected, setSelected] = useState<TranslationRecord | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // History is now async fetch from Google Sheets
    const fetchHistory = async () => {
      setLoading(true);
      const data = await storageService.getRecords();
      // Sort by newest first
      const sorted = data.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(sorted);
      setLoading(false);
    };
    fetchHistory();
  }, []);

  if (selected) {
    return (
      <div className="p-4 h-full flex flex-col">
        <button onClick={() => setSelected(null)} className="mb-4 flex items-center gap-2 text-indigo-600 font-medium">
          <ChevronRight className="rotate-180" size={20}/> Back to List
        </button>
        <div className="bg-white rounded-xl shadow-lg overflow-hidden flex-1 overflow-y-auto">
          {selected.type !== 'text' && (
            <img src={selected.original} className="w-full max-h-64 object-contain bg-gray-900" />
          )}
          <div className="p-6 space-y-4">
            <div>
              <span className="text-xs font-bold text-gray-400 uppercase">Date</span>
              <p className="text-sm">{new Date(selected.timestamp).toLocaleString()}</p>
            </div>
             <div>
              <span className="text-xs font-bold text-gray-400 uppercase">Language Pair</span>
              <p className="text-sm font-medium text-indigo-600">{selected.sourceLang} → {selected.targetLang}</p>
            </div>
            {selected.type === 'text' && (
               <div>
                <span className="text-xs font-bold text-gray-400 uppercase">Original</span>
                <p className="text-gray-800 bg-gray-50 p-3 rounded-lg mt-1">{selected.original}</p>
              </div>
            )}
            <div>
              <span className="text-xs font-bold text-gray-400 uppercase">Translation</span>
              <p className="text-gray-900 text-lg font-medium mt-1">{selected.translated}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 h-full overflow-y-auto">
      <h2 className="text-lg font-semibold text-gray-800 mb-4 flex justify-between items-center">
        Saved Translations
        {loading && <Loader2 className="animate-spin text-indigo-600" size={20} />}
      </h2>
      
      {!loading && records.length === 0 ? (
        <div className="text-center text-gray-400 mt-20">
          <History size={48} className="mx-auto mb-2 opacity-50" />
          <p>No history yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map(rec => (
            <div 
              key={rec.id} 
              onClick={() => setSelected(rec)}
              className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 active:bg-gray-50 transition-colors cursor-pointer"
            >
              <div className="w-12 h-12 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                {rec.type === 'text' ? (
                  <Type className="text-indigo-600" size={24} />
                ) : (
                  <img src={rec.original} className="w-full h-full object-cover" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">
                  {rec.type === 'text' ? rec.original : "Image Translation"}
                </p>
                <p className="text-xs text-gray-500">
                  {new Date(rec.timestamp).toLocaleDateString()} • {rec.sourceLang || '?'} → {rec.targetLang}
                </p>
              </div>
              <ChevronRight className="text-gray-300" size={20} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// 4. GUIDE TAB
const GuideView = () => (
  <div className="p-4 h-full overflow-y-auto">
    <div className="bg-indigo-600 text-white p-6 rounded-2xl mb-6 shadow-lg">
      <h2 className="text-2xl font-bold mb-2">Welcome!</h2>
      <p className="opacity-90">Here is how to use your new AI Translator.</p>
    </div>

    <div className="space-y-6">
      <div className="flex gap-4">
        <div className="bg-blue-100 p-3 rounded-full h-fit"><Type className="text-blue-600" /></div>
        <div>
          <h3 className="font-bold text-gray-900">Text Translation</h3>
          <p className="text-gray-600 text-sm mt-1">Select source and target languages, type your text, and translate.</p>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="bg-purple-100 p-3 rounded-full h-fit"><Upload className="text-purple-600" /></div>
        <div>
          <h3 className="font-bold text-gray-900">Photo Upload</h3>
          <p className="text-gray-600 text-sm mt-1">Upload an image. Choose languages to translate text within the photo.</p>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="bg-green-100 p-3 rounded-full h-fit"><Camera className="text-green-600" /></div>
        <div>
          <h3 className="font-bold text-gray-900">Live Camera</h3>
          <p className="text-gray-600 text-sm mt-1">Snap a photo directly to translate signs or menus.</p>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="bg-orange-100 p-3 rounded-full h-fit"><Save className="text-orange-600" /></div>
        <div>
          <h3 className="font-bold text-gray-900">History & Storage</h3>
          <p className="text-gray-600 text-sm mt-1">Translations are saved locally. Click history items to see full details.</p>
        </div>
      </div>
    </div>
  </div>
);

// --- MAIN LAYOUT ---

const App = () => {
  const [activeTab, setActiveTab] = useState<'text' | 'upload' | 'camera' | 'history' | 'guide'>('text');

  const renderContent = () => {
    switch (activeTab) {
      case 'text': return <TextTranslator />;
      case 'upload': return <ImageTranslator mode="upload" />;
      case 'camera': return <ImageTranslator mode="camera" />;
      case 'history': return <HistoryView />;
      case 'guide': return <GuideView />;
      default: return <TextTranslator />;
    }
  };

  const getTitle = () => {
    switch(activeTab) {
      case 'text': return 'Text Translate';
      case 'upload': return 'Photo Upload';
      case 'camera': return 'Camera';
      case 'history': return 'History';
      case 'guide': return 'User Guide';
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 max-w-md mx-auto shadow-2xl overflow-hidden relative border-x border-gray-200">
      <Header title={getTitle()} />
      
      <main className="flex-1 overflow-hidden relative">
        {renderContent()}
      </main>

      {/* Bottom Navigation */}
      <nav className="bg-white border-t border-gray-200 flex justify-between px-4 py-2 pb-safe">
        <NavBtn 
          active={activeTab === 'text'} 
          onClick={() => setActiveTab('text')} 
          icon={<Type size={22} />} 
          label="Text" 
        />
        <NavBtn 
          active={activeTab === 'upload'} 
          onClick={() => setActiveTab('upload')} 
          icon={<ImageIcon size={22} />} 
          label="Photo" 
        />
        
        {/* Floating Camera Button */}
        <div className="-mt-5 relative z-20">
           <button 
            onClick={() => setActiveTab('camera')}
            className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95 ${
              activeTab === 'camera' ? 'bg-indigo-700 ring-4 ring-indigo-100' : 'bg-indigo-600'
            }`}
          >
            <Camera className="text-white" size={26} />
          </button>
        </div>

        <NavBtn 
          active={activeTab === 'history'} 
          onClick={() => setActiveTab('history')} 
          icon={<History size={22} />} 
          label="History" 
        />
        <NavBtn 
          active={activeTab === 'guide'} 
          onClick={() => setActiveTab('guide')} 
          icon={<BookOpen size={22} />} 
          label="Guide" 
        />
      </nav>
    </div>
  );
};

const NavBtn = ({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) => (
  <button 
    onClick={onClick} 
    className={`flex flex-col items-center justify-center w-14 gap-1 transition-colors ${
      active ? 'text-indigo-600 font-semibold' : 'text-gray-400 hover:text-gray-600'
    }`}
  >
    {icon}
    <span className="text-[10px]">{label}</span>
  </button>
);

const root = createRoot(document.getElementById("root")!);
root.render(<App />);