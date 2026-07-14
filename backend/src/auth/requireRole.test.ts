import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { requireRole } from "./requireRole";
import { employeeRepository } from "../repositories/employeeRepository";

vi.mock("../repositories/employeeRepository", () => ({
  employeeRepository: { findById: vi.fn() },
}));

function mockRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe("requireRole", () => {
  beforeEach(() => {
    vi.mocked(employeeRepository.findById).mockReset();
  });

  it("calls next() when the employee has an allowed role", async () => {
    vi.mocked(employeeRepository.findById).mockResolvedValue({
      id: "emp-1",
      role: "admin",
      active: true,
    } as any);

    const req = { employeeId: "emp-1" } as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    await requireRole("admin")(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 when the employee's role isn't in the allowed list", async () => {
    vi.mocked(employeeRepository.findById).mockResolvedValue({
      id: "emp-1",
      role: "member",
      active: true,
    } as any);

    const req = { employeeId: "emp-1" } as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    await requireRole("admin")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 403 when the employee is deactivated, even with an allowed role", async () => {
    vi.mocked(employeeRepository.findById).mockResolvedValue({
      id: "emp-1",
      role: "admin",
      active: false,
    } as any);

    const req = { employeeId: "emp-1" } as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    await requireRole("admin")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 403 when there's no employeeId on the request", async () => {
    const req = {} as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    await requireRole("admin")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(employeeRepository.findById).not.toHaveBeenCalled();
  });
});
