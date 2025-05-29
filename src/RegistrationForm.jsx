import React, { useState } from "react";
import "./RegistrationForm.css";

export default function RegistrationForm({ onCreateRoom, onJoinRoom }) {
    const [name, setName] = useState("");
    const [ip, setIp] = useState("");
    const [error, setError] = useState("");

    function handle(action) {
        if (!name.trim() || !ip.trim()) {
            setError("Введите данные!");
            return;
        }
        setError("");
        if (action === "create") onCreateRoom(name, ip);
        if (action === "join") onJoinRoom(name, ip);
    }

    return (
        <div className="reg-container">
            <div className="reg-card">
                <div className="reg-logo">
                    {/* ...логотип svg... */}
                </div>
                <div className="reg-title">AirChat</div>
                <div className="reg-subtitle">
                    <strong>Регистрация</strong>
                    <div className="reg-desc">Введите ваше имя и IP</div>
                </div>
                <input
                    className="reg-input"
                    placeholder="Ваше имя"
                    value={name}
                    onChange={e => setName(e.target.value)}
                />
                <input
                    className="reg-input"
                    placeholder="Ваш IP (например 111.0.1.1)"
                    value={ip}
                    onChange={e => setIp(e.target.value)}
                />
                {error && <div className="reg-error">{error}</div>}
                <button
                    className="reg-btn reg-btn-main"
                    onClick={() => handle("create")}
                >
                    Создать комнату
                </button>
                <button
                    className="reg-btn reg-btn-secondary"
                    onClick={() => handle("join")}
                >
                    Войти в чат
                </button>
            </div>
        </div>
    );
}