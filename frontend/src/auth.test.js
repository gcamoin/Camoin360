import axios from "axios";
import { API_BASE_URL, createAppUser, getAuthToken, getCurrentUser, isTokenExpired, loginUser, updateAppUser } from "./auth";

jest.mock("axios");
const jwt = (claims) => `${btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${btoa(JSON.stringify(claims))}.synthetic-signature`;

beforeEach(() => { localStorage.clear(); jest.clearAllMocks(); });

it("reads expiry and account metadata from the JWT payload segment", () => {
  const token = jwt({ sub: "synthetic@example.invalid", name: "Synthetic", exp: Math.floor(Date.now() / 1000) + 60, organization_id: 17, modules: ["main"] });
  localStorage.setItem("sophie:authToken", token);
  expect(getAuthToken()).toBe(token);
  expect(getCurrentUser().organization_id).toBe(17);
  expect(isTokenExpired(token)).toBe(false);
});

it("clears expired and retired JSON-auth sessions", () => {
  for (const token of [jwt({ exp: 1 }), "legacy.signature", "malformed"]) {
    localStorage.setItem("sophie:authToken", token);
    localStorage.setItem("sophie:authUser", JSON.stringify({ name: "Old" }));
    expect(getAuthToken()).toBeNull();
    expect(localStorage.getItem("sophie:authUser")).toBeNull();
  }
});

it("preserves organization associations and existing login response fields", async () => {
  const user = { token: jwt({ exp: Math.floor(Date.now() / 1000) + 60 }), email: "synthetic@example.invalid", name: "Synthetic", role: "user", modules: ["main"], organization_id: 31 };
  axios.post.mockResolvedValue({ data: user });
  await loginUser({ email: user.email, password: "synthetic-password" });
  expect(getCurrentUser().organization_id).toBe(31);
  expect(getCurrentUser().modules).toEqual(["main"]);
});

it("passes eight-character passwords unchanged for login, account creation, and password updates", async () => {
  const password = "x".repeat(8);
  const user = { email: "synthetic@example.invalid", name: "Synthetic", role: "user", modules: ["main"], organization_id: 31 };
  axios.post.mockResolvedValue({ data: user });
  axios.patch.mockResolvedValue({ data: user });
  await loginUser({ email: user.email, password });
  expect(axios.post).toHaveBeenLastCalledWith(`${API_BASE_URL}/auth/login`, { email: user.email, password });
  await createAppUser({ ...user, password });
  expect(axios.post).toHaveBeenLastCalledWith(`${API_BASE_URL}/auth/users`, { ...user, password }, expect.any(Object));
  await updateAppUser(user.email, { password });
  expect(axios.patch).toHaveBeenLastCalledWith(`${API_BASE_URL}/auth/users/${encodeURIComponent(user.email)}`, { password }, expect.any(Object));
});
