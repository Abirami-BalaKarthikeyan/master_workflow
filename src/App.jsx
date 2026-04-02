import React, { useState, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  BackgroundVariant
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Mail, Bot, FileText, Send, X, Workflow, Activity, Settings, Sparkles, Loader2, Key, Copy, Check, Plus, Mic, ArrowUp } from 'lucide-react';
import './index.css';

const defaultNodes = [];
const defaultEdges = [];

const getIconForLabel = (label) => {
  const l = label?.toLowerCase() || '';
  if (l.includes('gmail')) return <Mail size={18} />;
  if (l.includes('send') || l.includes('mail')) return <Send size={18} />;
  if (l.includes('llm') || l.includes('ai') || l.includes('summarize')) return <Bot size={18} />;
  if (l.includes('document') || l.includes('extract')) return <FileText size={18} />;
  return <Activity size={18} />;
};

const CustomNode = ({ data, type, selected }) => {
  return (
    <div
      className={`bg-[#1a1d24] border rounded-xl p-4 min-w-[240px] max-w-[320px] shadow-sm transition-all duration-300 cursor-pointer relative overflow-hidden group ${selected
        ? 'border-indigo-500 shadow-[0_0_0_2px_rgba(99,102,241,0.15),0_10px_15px_-3px_rgba(0,0,0,0.2)] -translate-y-0.5'
        : 'border-[#2e323b] hover:border-gray-500 hover:shadow-xl'
        }`}
    >
      <div className={`absolute top-0 left-0 right-0 h-1 transition-colors duration-300 ${selected ? 'bg-indigo-500' : 'bg-[#2e323b]'}`} />
      {type !== 'input' && <Handle type="target" position={Position.Left} />}
      <div className="flex items-center gap-3 mb-2 mt-1">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-indigo-500/15 text-indigo-400 shrink-0">
          {getIconForLabel(data.label || data.type)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-white mb-0.5 whitespace-pre-wrap break-all">{data.label || data.type}</div>
          <div className="text-xs text-gray-400 whitespace-pre-wrap break-all">{data.description || data.type}</div>
        </div>
      </div>
      {type !== 'output' && <Handle type="source" position={Position.Right} />}
    </div>
  );
};

const parseDynamicWorkflow = (outputs) => {
  if (!outputs) return null;
  // Find the result that contains our workflow JSON string
  let workflowArray = null;
  for (const key in outputs) {
    if (outputs[key]?.result) {
      try {
        const parsed = typeof outputs[key].result === 'string' ? JSON.parse(outputs[key].result) : outputs[key].result;
        if (parsed.workflow && Array.isArray(parsed.workflow)) {
          workflowArray = parsed.workflow;
          break;
        }
      } catch (e) {
        // Continue searching
      }
    }
  }

  if (!workflowArray) return null;

  const dynamicNodes = workflowArray.map((step, index) => {
    let nodeType = "default";
    if (index === 0) nodeType = "input";
    if (index === workflowArray.length - 1 && workflowArray.length > 1) nodeType = "output";

    return {
      id: `node-${index}`,
      type: nodeType,
      position: { x: 100 + index * 320, y: 150 },
      data: {
        label: step.label || step.type,
        type: step.type,
        description: step.type,
        parameters: step.parameters
      }
    };
  });

  const dynamicEdges = [];
  for (let i = 0; i < dynamicNodes.length - 1; i++) {
    dynamicEdges.push({
      id: `edge-${i}-${i + 1}`,
      source: `node-${i}`,
      target: `node-${i + 1}`,
      animated: true,
      style: { stroke: '#6366f1', strokeWidth: 2 }
    });
  }

  return { dynamicNodes, dynamicEdges };
};

export default function App() {
  const [showPromptScreen, setShowPromptScreen] = useState(true);
  const [promptInput, setPromptInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [activeTab, setActiveTab] = useState('workflow');
  const [rawJSON, setRawJSON] = useState(null);
  const [copied, setCopied] = useState(false);

  const handleCopyJson = () => {
    if (rawJSON) {
      navigator.clipboard.writeText(JSON.stringify(rawJSON, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(defaultEdges);
  const [selectedNode, setSelectedNode] = useState(null);

  const nodeTypes = useMemo(() => ({
    input: CustomNode,
    default: CustomNode,
    output: CustomNode,
  }), []);

  const onNodeClick = useCallback((event, node) => setSelectedNode(node), []);
  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  const checkExecutionStatus = async (executionId, token) => {
    try {
      const baseUrl = import.meta.env.VITE_BASE_URL || "";
      const res = await fetch(`${baseUrl}/api/workflow-executions/${executionId}/status`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });

      const payload = await res.json().catch(() => null);

      const status = payload?.data?.status || payload?.status;

      if (status === "completed") {
        setRawJSON(payload);
        const parsed = parseDynamicWorkflow(payload?.data?.outputs);
        if (parsed) {
          setNodes(parsed.dynamicNodes);
          setEdges(parsed.dynamicEdges);
        } else {
          console.warn("Could not parse workflow JSON from outputs.");
        }
        setIsLoading(false);
        setShowPromptScreen(false);
      } else if (status === "running") {
        setTimeout(() => checkExecutionStatus(executionId, token), 5000);
      } else {
        alert(`Workflow generation error / failed status: ${status || 'Unknown error'}`);
        setIsLoading(false);
        setShowPromptScreen(false);
      }
    } catch (e) {
      console.error("Polling error:", e);
      setIsLoading(false);
      setShowPromptScreen(false);
    }
  };

  const handleGenerateWorkflow = async (e) => {
    e.preventDefault();
    if (!promptInput.trim()) return;

    setIsLoading(true);

    try {
      const baseUrl = import.meta.env.VITE_BASE_URL || "";
      const workflowId = import.meta.env.VITE_WORKFLOW_ID || "113";
      const response = await fetch(`${baseUrl}/api/webhooks/trigger/${workflowId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": import.meta.env.VITE_TURFAI_SECRET_KEY || ''
        },
        body: JSON.stringify({
          prompt: promptInput
        })
      });

      const data = await response.json().catch(() => null);
      console.log("TurfAI Webhook Response:", data);

      if (data?.success && data?.execution_id && data?.polling_token) {
        checkExecutionStatus(data.execution_id, data.polling_token);
      } else {
        setShowPromptScreen(false);
        setIsLoading(false);
      }
    } catch (error) {
      console.error("Error calling webhook:", error);
      alert("Failed to call Webhook API. Proceeding to default UI.");
      setShowPromptScreen(false);
      setIsLoading(false);
    }
  };

  if (showPromptScreen) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0f1115] relative overflow-hidden text-white font-sans">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/20 via-[#0f1115]/50 to-[#0f1115]" />

        <form
          onSubmit={handleGenerateWorkflow}
          className="relative z-10 bg-[#1a1d24]/90 backdrop-blur-xl border border-[#2e323b] p-8 rounded-2xl shadow-2xl w-full max-w-xl mx-4 transform transition-all"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-indigo-500/20 p-2.5 rounded-xl text-indigo-400">
              <Sparkles size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">TurfAI Automate</h1>
              <p className="text-sm text-gray-400 mt-1">Describe what you want your workflow to do.</p>
            </div>
          </div>

          <div className="relative bg-[#111319]/80 border border-[#2e323b] rounded-[28px] flex items-end p-2.5 shadow-xl transition-all focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 mb-6">
            <textarea
              value={promptInput}
              onChange={(e) => {
                setPromptInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(Math.max(e.target.scrollHeight, 60), 240)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (promptInput.trim() && !isLoading) {
                    handleGenerateWorkflow({ preventDefault: () => { } });
                  }
                }
              }}
              disabled={isLoading}
              placeholder="Describe your workflow..."
              className="flex-1 bg-transparent border-none outline-none pl-4 pr-3 py-3 text-[15px] leading-relaxed text-white placeholder-gray-500 resize-none custom-scrollbar"
              style={{ minHeight: '60px', height: '60px' }}
              required
            />
            <button
              type="submit"
              disabled={isLoading || !promptInput.trim()}
              className="bg-white hover:bg-gray-200 text-black font-semibold p-2.5 rounded-full flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 mb-0.5 ml-2"
            >
              {isLoading ? (
                <Loader2 size={20} className="animate-spin text-black" />
              ) : (
                <ArrowUp size={20} className="text-black" />
              )}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full relative bg-[#0f1115] font-sans text-white">
      <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-[#0f1115] via-[#0f1115]/90 to-transparent z-10 pointer-events-none">
        <div className="flex items-center justify-between mx-auto w-full gap-6 pointer-events-auto px-2">
          {/* Logo / Title */}
          <div className="text-xl font-semibold text-white flex items-center gap-3 drop-shadow-md shrink-0">
            <Workflow className="text-indigo-500" size={24} />
            <span className="hidden md:inline">Workflow Builder</span>
          </div>

          {/* Redefine Prompt Box */}
          <form onSubmit={handleGenerateWorkflow} className="flex-1 max-w-4xl bg-[#1a1d24]/90 backdrop-blur-xl border border-[#2e323b] rounded-[28px] flex items-end p-2.5 shadow-lg transition-all focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500">
            <textarea
              value={promptInput}
              onChange={(e) => {
                setPromptInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(Math.max(e.target.scrollHeight, 60), 240)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (promptInput.trim() && !isLoading) {
                    handleGenerateWorkflow({ preventDefault: () => { } });
                  }
                }
              }}
              disabled={isLoading}
              rows={1}
              className="flex-1 bg-transparent border-none outline-none text-[15px] leading-relaxed text-white pl-4 pr-3 py-3 resize-none custom-scrollbar"
              style={{ minHeight: '60px', height: '60px' }}
              placeholder="Refine prompt..."
            />
            <button
              type="submit"
              disabled={isLoading || !promptInput.trim()}
              className="bg-white hover:bg-gray-200 text-black disabled:opacity-50 disabled:cursor-not-allowed p-2.5 rounded-full flex items-center justify-center transition-all mb-0.5 flex-shrink-0 ml-2"
            >
              {isLoading ? (
                <Loader2 size={18} className="animate-spin text-black" />
              ) : (
                <ArrowUp size={18} className="text-black" />
              )}
            </button>
          </form>

          {/* Tabs on the Right */}
          <div className="hidden md:flex shrink-0 items-center">
            <div className="bg-[#1a1d24]/90 backdrop-blur-md p-1 rounded-lg border border-[#2e323b] flex gap-1 shadow-lg">
              <button
                onClick={() => setActiveTab('workflow')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'workflow' ? 'bg-indigo-500 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
              >
                Workflow
              </button>
              <button
                onClick={() => setActiveTab('json')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'json' ? 'bg-indigo-500 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
              >
                JSON Raw
              </button>
            </div>
          </div>
        </div>
      </div>

      {activeTab === 'workflow' ? (
        <>
          <div className="flex-1 h-full relative">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              nodeTypes={nodeTypes}
              fitView
              colorMode="dark"
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#2e323b" />
              <Controls position="bottom-left" style={{ margin: '24px' }} />
              <MiniMap
                nodeColor={() => '#6366f1'}
                maskColor="rgba(15, 17, 21, 0.7)"
                style={{ backgroundColor: '#1a1d24', border: '1px solid #2e323b', borderRadius: '8px' }}
                position="bottom-right"
              />
            </ReactFlow>
          </div>

          <div
            className={`h-full bg-[#1a1d24]/85 backdrop-blur-xl border-l border-[#2e323b] transition-all duration-300 ease-out overflow-hidden shadow-[-10px_0_30px_rgba(0,0,0,0.3)] flex flex-col z-20 ${selectedNode ? 'w-[380px]' : 'w-0'
              }`}
          >
            <div className="p-6 border-b border-[#2e323b] flex items-center justify-between min-w-[380px]">
              <div className="text-lg font-semibold flex items-center gap-2 text-white">
                <Settings className="text-indigo-500" size={20} /> Node Configuration
              </div>
              <button
                className="bg-transparent border-none text-gray-400 cursor-pointer p-1.5 flex items-center justify-center rounded-md transition-colors hover:bg-white/10 hover:text-white"
                onClick={() => setSelectedNode(null)}
              >
                <X size={20} />
              </button>
            </div>

            {selectedNode && (
              <div className="p-6 flex-1 overflow-y-auto min-w-[380px] custom-scrollbar">
                <div className="mb-7">
                  <div className="text-xs uppercase tracking-widest text-gray-400 mb-2.5 font-semibold">Type</div>
                  <div className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-indigo-500/15 text-indigo-400 uppercase tracking-widest">
                    {selectedNode.type}
                  </div>
                </div>

                <div className="mb-7">
                  <div className="text-xs uppercase tracking-widest text-gray-400 mb-2.5 font-semibold">Node Name</div>
                  <div className="text-sm text-white bg-black/20 p-3.5 rounded-lg border border-[#2e323b] leading-relaxed">
                    {selectedNode.data.label}
                  </div>
                </div>

                {selectedNode.data.parameters && Object.keys(selectedNode.data.parameters).length > 0 && (
                  <div className="mb-7">
                    <div className="text-xs uppercase tracking-widest text-gray-400 mb-2.5 font-semibold flex items-center gap-2">
                      <Key size={14} /> Details
                    </div>
                    <div className="text-sm text-white bg-[#0f1115] p-4 rounded-lg border border-[#2e323b] overflow-x-auto">
                      <pre className="text-indigo-300 font-mono text-xs">
                        {JSON.stringify(selectedNode.data.parameters, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                <div className="mb-7">
                  <div className="text-xs uppercase tracking-widest text-gray-400 mb-2.5 font-semibold">Position</div>
                  <div className="flex gap-4 text-sm text-white bg-black/20 p-3.5 rounded-lg border border-[#2e323b]">
                    <div><strong className="text-gray-400 pr-1">X:</strong> {Math.round(selectedNode.position.x)}</div>
                    <div><strong className="text-gray-400 pr-1">Y:</strong> {Math.round(selectedNode.position.y)}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 h-full relative pt-28 pb-8 px-8 flex justify-center overflow-hidden">
          <div className="w-full max-w-5xl h-full bg-[#1a1d24] border border-[#2e323b] rounded-xl overflow-hidden shadow-2xl flex flex-col">
            <div className="bg-[#2e323b]/50 p-3 border-b border-[#2e323b] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-300">workflow_definition.json</span>
              </div>
              <button
                onClick={handleCopyJson}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#1a1d24] border border-[#2e323b] hover:border-gray-500 rounded-md text-xs font-medium text-gray-400 hover:text-white transition-all hover:shadow-md"
              >
                {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                {copied ? "Copied!" : "Copy JSON"}
              </button>
            </div>
            <div className="p-6 overflow-auto flex-1 custom-scrollbar">
              <pre className="font-mono text-sm text-indigo-300 leading-relaxed">
                {rawJSON ? JSON.stringify(rawJSON, null, 2) : "// No JSON output available."}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
