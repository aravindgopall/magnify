"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseSubagent = void 0;
class BaseSubagent {
    id;
    config;
    constructor(config) {
        this.id = config.id;
        this.config = config;
    }
    createSuccessResult(groupId, data, duration) {
        return {
            agentId: this.id,
            groupId,
            success: true,
            data,
            duration,
        };
    }
    createErrorResult(groupId, error, duration) {
        return {
            agentId: this.id,
            groupId,
            success: false,
            error,
            duration,
        };
    }
    buildExtractionPrompt(group) {
        const content = group.pages.map(p => p.text).join('\n\n');
        const customPrompt = this.config.customPrompt || this.getDefaultPrompt();
        return `${customPrompt}

Document Section: ${group.title || `Pages ${group.startPage}-${group.endPage}`}
Pages: ${group.startPage} to ${group.endPage}

Content:
${content}

Extract and structure the information from this document section.`;
    }
    getDefaultPrompt() {
        return `You are a document extraction agent. Your task is to analyze the provided document section and extract structured information.

Please extract:
1. A title for this section (if identifiable)
2. A brief summary (2-3 sentences)
3. Key entities (people, organizations, dates, amounts, etc.)
4. Main sections and their content
5. Any tables present
6. Relevant metadata

Format your response as structured JSON.`;
    }
}
exports.BaseSubagent = BaseSubagent;
//# sourceMappingURL=base-agent.js.map