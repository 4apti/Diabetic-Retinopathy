from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, EmailStr


# ---------- Auth ----------
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str
    role: str


class UserRegister(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    role: str = "patient"  # patient | health_worker | doctor


# ---------- Patients ----------
class PatientCreate(BaseModel):
    full_name: str
    age: Optional[int] = None
    gender: Optional[str] = None
    village: Optional[str] = None
    district: Optional[str] = None
    phone: Optional[str] = None


class PatientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    age: Optional[int] = None
    gender: Optional[str] = None
    village: Optional[str] = None
    district: Optional[str] = None
    phone: Optional[str] = None
    created_at: datetime


# ---------- Uploads ----------
class FindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    image_id: str
    lesion_list: Any = []
    lesion_count: int = 0
    icdr_grade: Optional[int] = None
    icdr_confidence: Optional[float] = None
    consistency_status: str = "pending"
    analysis_status: str = "queued"
    analyzed_at: Optional[datetime] = None
    model_provenance: Optional[str] = None


class UploadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    image_id: str
    patient_id: int
    filename: str
    quality_status: str
    quality_score: Optional[float] = None
    uploaded_at: datetime

    findings: list[FindingOut] = []


# ---------- Dashboard ----------
class RoleStats(BaseModel):
    total_patients: int
    total_scans: int
    scans_analyzed: int
    scans_pending: int
    flagged_for_review: int
    grade_distribution: dict[int, int] = {}


class ModelInfo(BaseModel):
    name: str
    family: str
    task: str
    trained_on: str
    fine_tuned: bool
    weights: bool
    weights_path: str
    validation: dict[str, Any] = {}
    note: str


TokenResponse.model_rebuild()