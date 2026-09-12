/**
 * SaaS GrimReaper Backend HTTP API Server
 *
 * Exposes Webcmd browser orchestration, risk evaluation, potential savings,
 * approval state machine transitions, and audit logs to the HTML UI dashboard.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GrimReaperOrchestrator } from './orchestrator.ts';
import type { GitHubAuditOptions } from './adapters/github.ts';
import type { SlackAuditOptions } from './adapters/slack.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export function createGrimReaperServer(orchestratorInstance?: GrimReaperOrchestrator) {
  const orchestrator = orchestratorInstance ?? new GrimReaperOrchestrator({
    riskEngineOptions: { inactivity_threshold_days: 90 },
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method?.toUpperCase();

    const sendJson = (statusCode: number, data: unknown) => {
      res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end(JSON.stringify(data));
    };

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    try {
      // Serve static UI HTML
      if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        const htmlPath = path.join(PUBLIC_DIR, 'index.html');
        if (fs.existsSync(htmlPath)) {
          const content = fs.readFileSync(htmlPath, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(content);
          return;
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('HTML UI file not found in public directory.');
          return;
        }
      }

      // GET /api/dashboard - Returns summary, candidates list, potential savings & audit logs
      if (method === 'GET' && pathname === '/api/dashboard') {
        const candidates = orchestrator.getCandidates();
        const savings = orchestrator.getPotentialSavings();
        const logs = orchestrator.getAuditLogger().getRecords();

        const total_seats = candidates.length;
        const inactive_candidates = candidates.filter((c) => c.risk.flagged).length;

        sendJson(200, {
          demo_mode: orchestrator.isDemoMode(),
          summary: {
            total_seats,
            inactive_candidates,
            monthly_potential_savings: savings.monthly_potential_savings,
            annual_potential_savings: savings.annual_potential_savings,
          },
          candidates,
          savings,
          logs,
        });
        return;
      }

      // POST /api/audit/github - Triggers GitHub browser audit
      if (method === 'POST' && pathname === '/api/audit/github') {
        const body = await parseBody(req);
        const options: GitHubAuditOptions = {
          orgName: (body.orgName as string) || 'acme-corp',
          profile: (body.profile as string) || 'github-admin',
          fetchAuditLogActivity: body.fetchAuditLogActivity !== false,
        };

        const result = await orchestrator.auditGitHub(options);
        sendJson(200, result);
        return;
      }

      // POST /api/audit/slack - Triggers Slack browser audit
      if (method === 'POST' && pathname === '/api/audit/slack') {
        const body = await parseBody(req);
        const options: SlackAuditOptions = {
          workspaceSlug: (body.workspaceSlug as string) || 'acme-corp',
          profile: (body.profile as string) || 'slack-admin',
          monthlyCostPerSeat: (body.monthlyCostPerSeat as number) || 8.75,
        };

        const result = await orchestrator.auditSlack(options);
        sendJson(200, result);
        return;
      }

      // POST /api/candidates/approval-request - Transitions candidate to PENDING_APPROVAL
      if (method === 'POST' && pathname === '/api/candidates/approval-request') {
        const body = await parseBody(req);
        const userId = body.userId as string;
        if (!userId) {
          sendJson(400, { error: 'Missing userId parameter' });
          return;
        }
        const candidate = orchestrator.requestApproval(userId);
        sendJson(200, candidate);
        return;
      }

      // POST /api/candidates/approve - Transitions candidate to APPROVED via approval state machine
      if (method === 'POST' && pathname === '/api/candidates/approve') {
        const body = await parseBody(req);
        const userId = body.userId as string;
        if (!userId) {
          sendJson(400, { error: 'Missing userId parameter' });
          return;
        }

        let candidate = orchestrator.getCandidate(userId);
        if (!candidate) {
          sendJson(404, { error: `Candidate user '${userId}' not found.` });
          return;
        }

        if (candidate.approval_state === 'FLAGGED') {
          candidate = orchestrator.requestApproval(userId);
        }

        if (candidate.approval_state === 'PENDING_APPROVAL') {
          candidate = orchestrator.approveCandidate(userId);
        }

        sendJson(200, candidate);
        return;
      }

      // POST /api/candidates/reject - Transitions candidate to REJECTED via approval state machine
      if (method === 'POST' && pathname === '/api/candidates/reject') {
        const body = await parseBody(req);
        const userId = body.userId as string;
        if (!userId) {
          sendJson(400, { error: 'Missing userId parameter' });
          return;
        }
        const reason = (body.reason as string) || 'Rejected by admin via UI';
        const candidate = orchestrator.rejectCandidate(userId, reason);
        sendJson(200, candidate);
        return;
      }

      // POST /api/candidates/execute - Executes offboarding for an explicitly APPROVED candidate
      if (method === 'POST' && pathname === '/api/candidates/execute') {
        const body = await parseBody(req);
        const userId = body.userId as string;
        if (!userId) {
          sendJson(400, { error: 'Missing userId parameter' });
          return;
        }

        const candidate = orchestrator.getCandidate(userId);
        if (!candidate) {
          sendJson(404, { error: `Candidate user '${userId}' not found.` });
          return;
        }

        if (candidate.approval_state !== 'APPROVED') {
          sendJson(403, {
            error: `SECURITY VIOLATION: Candidate '${userId}' must be in APPROVED state (current state: '${candidate.approval_state}').`,
            status: 'UNAUTHORIZED_STATE',
          });
          return;
        }

        const execRes = await orchestrator.executeCandidateOffboarding(userId);
        sendJson(200, execRes);
        return;
      }

      sendJson(404, { error: `Route not found: ${method} ${pathname}` });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendJson(500, { error: errorMsg });
    }
  });

  return { server, orchestrator };
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!body) resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Start server if executed directly
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('server.ts')) {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const { server } = createGrimReaperServer();
  server.listen(port, () => {
    console.log(`SaaS GrimReaper UI Dashboard running at http://localhost:${port}`);
  });
}
