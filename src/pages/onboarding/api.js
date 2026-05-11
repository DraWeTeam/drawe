import api from "../login/api";

export const getOnboardingStatus = async () => {
  const res = await api.get("/onboarding/status");
  return res.data.data;  // { completed: true/false }
};

export const getOnboardingImages = async () => {
  const res = await api.get("/onboarding/images");
  return res.data.data;  // [{ id, url, technique, ... }]
};

export const submitOnboarding = async (selectedImageIds) => {
  const res = await api.post("/onboarding", { selectedImageIds });
  return res.data;
};