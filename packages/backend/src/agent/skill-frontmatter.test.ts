/**
 * skill-frontmatter.test.ts
 *
 * Guard against silently-broken template skills. pi's loadSkills() drops
 * any skill with a missing/empty `description` field (only a warning
 * diagnostic that nobody reads), so a malformed SKILL.md ships happily,
 * never appears in the agent's <available_skills> prompt block, and the
 * first hint of trouble is the user asking "why doesn't X work?".
 *
 * This test walks every shipped skill template under
 * packages/cli/templates/skills/ and fails the build if any of them has
 * frontmatter pi would reject.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { validateSkillFrontmatter } from './runner-pi.js';

const templatesSkillsDir = path.resolve(__dirname, '../../../cli/templates/skills');

describe('shipped skill templates', () => {
  it('templates/skills directory exists', () => {
    expect(fs.existsSync(templatesSkillsDir)).toBe(true);
  });

  const skillNames = fs.existsSync(templatesSkillsDir)
    ? fs.readdirSync(templatesSkillsDir).filter((name) => {
        const full = path.join(templatesSkillsDir, name);
        return fs.statSync(full).isDirectory();
      })
    : [];

  it('at least one skill ships', () => {
    expect(skillNames.length).toBeGreaterThan(0);
  });

  for (const skillName of skillNames) {
    it(`"${skillName}" has valid frontmatter pi will accept`, () => {
      const skillMdPath = path.join(templatesSkillsDir, skillName, 'SKILL.md');
      const issues = validateSkillFrontmatter(skillMdPath, skillName);
      // Custom failure message so CI output points straight at the broken file.
      expect(issues, `${skillMdPath}: ${issues.join('; ')}`).toEqual([]);
    });
  }
});
