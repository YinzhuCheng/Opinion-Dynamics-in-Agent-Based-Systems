import { NavLink } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import './TopNav.css';

const navItems = [
  { path: '/', label: '配置', key: 'configuration' },
  { path: '/dialogue', label: '对话', key: 'dialogue' },
  { path: '/results', label: '结果', key: 'results' },
];

export function TopNav() {
  const currentPage = useAppStore((state) => state.currentPage);
  const setCurrentPage = useAppStore((state) => state.setCurrentPage);

  return (
    <header className="top-nav">
      <div className="top-nav__logo" onClick={() => setCurrentPage('configuration')}>
        <span className="top-nav__logo-mark">ODM</span>
        <span className="top-nav__logo-text">Opinion Dynamics Multi-Agent</span>
      </div>
      <nav className="top-nav__links">
        {navItems.map((item) => (
          <NavLink
            key={item.key}
            to={item.path}
            className={({ isActive }) =>
              ['top-nav__link', isActive || currentPage === item.key ? 'active' : '']
                .filter(Boolean)
                .join(' ')
            }
            onClick={() => setCurrentPage(item.key as typeof currentPage)}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
