"""Seeds the database with demo accounts and a handful of patients/scans.

Run:  python -m app.seed   (from the backend/ directory)
"""

from .database import Base, SessionLocal, engine
from .models import AIFinding, ImageUpload, Patient, User
from .security import hash_password

DEMO_USERS = [
    {
        "email": "admin@netrascan.in",
        "full_name": "NetraScan Administrator",
        "role": "admin",
        "password": "Admin123!",
    },
    {
        "email": "patient@example.org",
        "full_name": "Anita Sharma",
        "role": "patient",
        "password": "Patient123!",
    },
    {
        "email": "worker@example.org",
        "full_name": "Ravi Kumar",
        "role": "health_worker",
        "password": "Worker123!",
    },
    {
        "email": "doctor@example.org",
        "full_name": "Dr. Meera Iyer",
        "role": "doctor",
        "password": "Doctor123!",
    },
]


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        users = {}
        for spec in DEMO_USERS:
            existing = db.query(User).filter(User.email == spec["email"]).first()
            if existing:
                users[spec["role"]] = existing
                continue
            user = User(
                email=spec["email"],
                full_name=spec["full_name"],
                role=spec["role"],
                hashed_password=hash_password(spec["password"]),
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            users[spec["role"]] = user

        worker = users["health_worker"]
        anita = db.query(Patient).filter(Patient.own_user_id == users["patient"].id).first()
        if anita is None:
            anita = Patient(
                full_name="Anita Sharma",
                age=54,
                gender="Female",
                village="Rampur",
                district="Sitapur",
                phone="+91 90000 00001",
                own_user_id=users["patient"].id,
                created_by=worker.id,
            )
            db.add(anita)

        demo_patients = [
            {
                "full_name": "Mohammed Faizal",
                "age": 61,
                "gender": "Male",
                "village": "Kalluvathukkal",
                "district": "Kollam",
                "phone": "+91 90000 00002",
            },
            {
                "full_name": "Lakshmi Devi",
                "age": 47,
                "gender": "Female",
                "village": "Baramati",
                "district": "Pune",
                "phone": "+91 90000 00003",
            },
        ]
        for spec in demo_patients:
            existing = db.query(Patient).filter(Patient.phone == spec["phone"]).first()
            if not existing:
                db.add(Patient(**spec, created_by=worker.id))

        db.commit()
        print("Seeded demo accounts:")
        for spec in DEMO_USERS:
            print(f"  {spec['role']:<13} {spec['email']:<30} {spec['password']}")
        print("Done.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()