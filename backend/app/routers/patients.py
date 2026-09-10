from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user, require_roles
from ..models import ImageUpload, Patient, User
from ..schemas import PatientCreate, PatientOut, UploadOut

router = APIRouter(prefix="/patients", tags=["patients"])


@router.get("", response_model=list[PatientOut])
def list_patients(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "health_worker", "doctor")),
):
    if user.role == "health_worker":
        return db.query(Patient).filter(Patient.created_by == user.id).all()
    return db.query(Patient).all()


@router.get("/self", response_model=PatientOut)
def my_record(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("patient")),
):
    patient = db.query(Patient).filter(Patient.own_user_id == user.id).first()
    if patient is None:
        raise HTTPException(status_code=404, detail="No patient record linked to this account")
    # materialize most recent upload
    uploads = (
        db.query(ImageUpload)
        .filter(ImageUpload.patient_id == patient.id)
        .order_by(ImageUpload.uploaded_at.desc())
        .all()
    )
    patient.latest_upload = uploads[0] if uploads else None  # type: ignore[attr-defined]
    return patient


@router.post("", response_model=PatientOut, status_code=201)
def create_patient(
    payload: PatientCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "health_worker")),
):
    patient = Patient(**payload.model_dump(), created_by=user.id)
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


@router.get("/{patient_id}", response_model=PatientOut)
def get_patient(
    patient_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    if user.role == "health_worker" and patient.created_by != user.id:
        raise HTTPException(status_code=403, detail="Not allowed to view this patient")
    return patient


@router.get("/{patient_id}/scans", response_model=list[UploadOut])
def patient_scans(
    patient_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    if user.role == "patient" and patient.own_user_id != user.id:
        raise HTTPException(status_code=403, detail="Not allowed to view this patient")
    if user.role == "health_worker" and patient.created_by != user.id:
        raise HTTPException(status_code=403, detail="Not allowed to view this patient")
    return (
        db.query(ImageUpload)
        .filter(ImageUpload.patient_id == patient.id)
        .order_by(ImageUpload.uploaded_at.desc())
        .all()
    )