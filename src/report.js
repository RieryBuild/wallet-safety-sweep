// Report rendering: human-readable text and machine-readable JSON.
// The text report is the deliverable most people read; it leads with the
// verdict, then the evidence, then exactly what to do about each finding.

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const SEVERITY_ICON = {
  critical: '⛔',
  high: '🔴',
  medium: '🟡',
  low: '🔵',
  info: 'ℹ️',
};

export function renderText(report) {
  const lines = [];
  const gradeIcon = { SAFE: '✅', CAUTION: '⚠️', RISKY: '🔴', DANGER: '⛔' }[report.grade];
  lines.push(`${gradeIcon} ${report.grade} — safety score ${report.score}/100`);
  lines.push(`  wallet   ${report.address}`);
  lines.push(`  chain    ${report.chainName} (chain id ${report.chainId})`);
  lines.push(`  block    ${report.blockNumber} (all reads pinned to this block)`);
  lines.push(`  native   ${report.nativeBalanceFormatted} ${report.nativeSymbol}`);
  if (report.delegated) {
    lines.push(`  delegate ${report.delegated} (EIP-7702)`);
  } else if (report.isContract) {
    lines.push('  type     smart contract wallet');
  } else {
    lines.push('  type     EOA (not delegated)');
  }
  lines.push('');

  const held = report.balances.filter((b) => b.balance !== null && BigInt(b.balance) > 0n);
  if (held.length > 0) {
    lines.push('Balances (checked tokens):');
    for (const b of held) {
      lines.push(`  ${b.token.symbol.padEnd(6)} ${b.balanceFormatted}`);
    }
    lines.push('');
  }

  const findings = [...report.findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  if (findings.length === 0) {
    lines.push('No findings. No allowances to the checked spenders, no delegation, no unreadable tokens.');
  } else {
    lines.push(`Findings (${findings.length}):`);
    for (const f of findings) {
      lines.push('');
      lines.push(`${SEVERITY_ICON[f.severity]} [${f.severity.toUpperCase()}] ${f.title}`);
      lines.push(`  ${f.detail}`);
      if (f.code === 'UNLIMITED_ALLOWANCE' || f.code === 'ALLOWANCE_COVERS_BALANCE') {
        lines.push('  fix: revoke or cap it —');
        lines.push(`    revoke.cash: ${report.explorer.replace('bscscan.com', 'revoke.cash').replace('etherscan.io', 'revoke.cash')}/address/${report.address}`);
        lines.push(`    or cast: cast send ${f.token.address} "approve(address,uint256)" ${f.spender.address} 0 --from ${report.address}`);
      }
      if (f.code === 'EIP7702_DELEGATED') {
        lines.push('  fix: clear the delegation from a trusted wallet UI, or set it to a delegation you control. Do not send funds here until it is cleared.');
      }
    }
  }
  lines.push('');
  lines.push(`Score ${report.score}/100 — ${report.grade}. Re-run after revoking to confirm the score moves.`);
  return lines.join('\n');
}

export function renderJson(report) {
  return JSON.stringify(report, null, 2);
}
