import { useTheme } from "../../context/ThemeContext";

export default function Tag({ label, color }) {
  const C = useTheme();

  return (
    <span
      style={{
        padding: "3px 10px",
        borderRadius: 20,
        fontSize: 11,
        background: color + "22",
        border: `1px solid ${color}44`,
        color,
      }}
    >
      {label}
    </span>
  );
}
