/* First-order diffraction at normal incidence: λ = P_mask sin θ, r = g tan θ. */
'use strict';
window.OM11Diffraction = Object.freeze({
  wavelengthFromRadius(rUm, gapUm, maskPitchNm) {
    if (![rUm,gapUm,maskPitchNm].every(Number.isFinite) || rUm<0 || gapUm<=0 || maskPitchNm<=0) return null;
    return maskPitchNm * (rUm / Math.hypot(gapUm,rUm));
  },
  gapFromRadius(rUm, wavelengthNm, maskPitchNm) {
    if (![rUm,wavelengthNm,maskPitchNm].every(Number.isFinite) || rUm<0 || wavelengthNm<=0 || wavelengthNm>=maskPitchNm) return null;
    return rUm * Math.sqrt((maskPitchNm-wavelengthNm)*(maskPitchNm+wavelengthNm)) / wavelengthNm;
  }
});
