## Summary

- What changed and why?

## Safety and compatibility

- [ ] Zero npm dependencies remain.
- [ ] Authentication, loopback binding, and redaction defaults remain safe.
- [ ] No credentials, runtime data, prompts, or private error bodies are included.
- [ ] Chinese and English i18n keys remain in parity when UI text changes.

## Verification

- [ ] `npm.cmd run check`
- [ ] `npm.cmd run test:unit`
- [ ] `npm.cmd run test:e2e`
- [ ] `npm.cmd run pre-release`
- [ ] Release artifacts verified when packaging changed.
